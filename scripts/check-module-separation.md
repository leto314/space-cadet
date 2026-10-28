# check-module-separation

A check that every **mission module** of Space Cadet is split in two files: its **logic** (pure JavaScript) and
its **screen** (React), and that the **mission core** (which modules fly together, where their blocks go, how the
flight is scored) can be loaded without React. It is the mission counterpart of
[`check-game-separation.md`](check-game-separation.md). No knowledge of the app is needed to run it or to read
its report.

## What it is about

A daily mission runs several "systems" (modules) at the same time on one board, like a cockpit: hold an altitude,
answer the radio, solve a logic panel… There are 25 of them, declared in `src/missions/modules/index.js`. Each one
must live in its own folder and be split like a game:

| File | Contains | May import |
|---|---|---|
| `src/missions/modules/<module>/logic.js` | the module's **spec** (competence, task, load, briefing text, blocks), the content it shows (built from the mission's seed) and its scoring | only `../../../utils/random.js`, another module's `logic.js`, or a game's `logic.js` |
| `src/missions/modules/<module>/<Name>Module.js` | the screen: React components, animations, styles, and the declaration `{ ...spec, Component }` | anything, including `./logic` |

Plus the **mission core**, which must stay pure so a mission can be rebuilt and checked outside the app:

| File | Contains |
|---|---|
| `src/missions/generator.js` | which modules fly together on a given day, and the rules they must obey |
| `src/missions/layout.js` | where each block goes on the 4 × 8 board |
| `src/missions/score.js` | how the modules' performances become the mission's score out of 1000 |
| `src/missions/modules/specs.js` | the catalogue of module specs, readable without React (what the generator reads) |

Why: the generator decides what every player gets today, and the score decides what the mission is worth. Kept
pure, both can be loaded and tested with plain Node — see [`missions/README.md`](missions/README.md), which tests
what this check cannot: whether the logic is *right*.

Randomness rule, as for the games: a module never draws its own random numbers. The mission hands it
`runtime.seed` (derived from the mission's seed and the module's id) and the logic turns it into a generator.
Same mission → same content, on every phone.

## How to run it

From the project folder, with Node 20 or newer. Nothing to install (no `npm install` needed).

```bash
node scripts/check-module-separation.mjs              # PASS / FAIL per module, then the mission core (default)
node scripts/check-module-separation.mjs --details     # same, plus what is wrong in each failing module (file, line)
node scripts/check-module-separation.mjs --all         # also the shared mission screens (informational)
node scripts/check-module-separation.mjs --help
```

(`npm run check:modules` does the same once the project's dependencies are installed.)

The report shows one line per competence and per module, then the mission core, then a `GENERAL` verdict. Exit
code is 0 when every registered module and every core file passes, 1 otherwise (so it can run in CI).

```
LOGIC                                            FAIL
  logic-gates            NOT SPLIT  (4 issues)
  mini-landing           NOT SPLIT  (4 issues)
  ...
MISSION CORE
  generator.js           FAIL  (4 issues)
  layout.js              PASS  (where their blocks go on the board)
GENERAL
  25 OF 25 MODULES FAIL THE TEST  (0 of them have a logic.js; 25 are not split yet)
```

A module is reported `NOT SPLIT` while it has no `logic.js` yet, and `FAIL` once it has one but breaks a rule.
Both count as a failure: unlike the game check, there is no "not finished yet" grace period — the modules are all
already in the app. Today every module and every core file passes:

```
GENERAL
  EVERY MODULE IS CORRECTLY SPLIT  (25/25 registered modules)
  THE MISSION CORE LOADS IN PLAIN NODE  (4/4 files)
```

## What is checked

| # | Rule | Applies to | Example that FAILS | Example that PASSES |
|---|---|---|---|---|
| 1a | The module has its own folder | `src/missions/modules/index.js` | `import { altitudeModule } from "./AltitudeModule"` (a flat file) | `from "./altitude/AltitudeModule"` |
| 1b | `logic.js` exists in that folder | the folder | the folder only holds `AltitudeModule.js` | `altitude/logic.js` + `altitude/AltitudeModule.js` |
| 1c | A screen file of the folder imports `./logic` | screen files | `logic.js` exists but nothing imports it | `import { altitudeSpec, moduleResult } from "./logic";` |
| 1d | The declaration is the spec plus the component | screen files | `export const altitudeModule = { id: "altitude", load: 3, blocks: [...], Component }` | `export const altitudeModule = { ...altitudeSpec, Component: AltitudeModule };` |
| 1e | `modules/index.js` registers it in `MODULES` | `index.js` | the import is there but `[altitudeModule.id]: altitudeModule` is not | both present |
| 2a | No `Math.random` | every `.js` of the folder except `logic.js` | `const target = Math.random() * 100` in a component | the content comes from `buildContent(spec, runtime.seed, …)` |
| 2b | No `createRandom` / `randomTools` | screen files | `const rnd = randomTools(createRandom(runtime.seed))` in a component | the logic builds the generator from the seed it is given |
| 2c | Screen files export only React components or module declarations | screen files | `export function buildPanel(rnd)` | `export function AltitudeModule()`, `export const altitudeModule` |
| 3a | `logic.js` imports only `../../../utils/random.js`, another module's `logic.js` or a game's `logic.js` | `logic.js` | `import { SPACE_CADET } from "../../../theme/spaceCadet"` | `import { createRandom } from "../../../utils/random.js";` |
| 3b | Those imports carry the `.js` extension | `logic.js` | `from "../../../utils/random"` (Node cannot resolve it) | `from "../../../utils/random.js"` |
| 3c | `logic.js` never calls `Math.random` | `logic.js` | `function buildTarget(random = Math.random)` | `function buildTarget(random)` |
| 3d | `logic.js` contains no JSX | `logic.js` | `return <View />;` | — |
| 3e | `logic.js` really loads in plain Node (`import()`) | `logic.js` | passes 3a–3d but throws at load (`__DEV__ is not defined`) | loads, exports listed |
| 4 | The mission core follows the same rules | `generator.js`, `layout.js`, `score.js`, `modules/specs.js` | `generator.js` imports `./modules` (which imports React) | it imports `./modules/specs.js`, the pure catalogue |

Notes:
- Rules 2a–2b and 3c ignore matches inside `//` comments.
- The module list, their ids and their competences are read from the app's own files
  (`src/missions/modules/index.js` and each module's declaration, following the `...baseDefinition` a variant
  spreads). Nothing is hard-coded: a module added to `index.js` becomes strict automatically.
- Several modules may share one folder when they are variants of the same system (`anomaly` and `anomaly-lite`,
  `tracking` and `tracking-mini`): the folder then holds one `logic.js` exporting one spec per variant. Issues
  found in a shared file are reported once per module.

## What is NOT checked (known limits)

| Gap | Why it matters | Example that slips through | What covers it |
|---|---|---|---|
| Whether the logic is **right** | the check only looks at structure and purity | a spec declaring `load: 99`, a module whose content ignores its seed | `npm run test:missions` (the mission logic tests) |
| Logic left in a screen file, **unexported** | rule 2c only sees exports, 2a–2b only random draws | `function buildPanel(rnd) { … }` declared and used inside the component | manual review when a module is split |
| Scoring left in a screen file | `performance` is a number the screen can compute inline | `runtime.register(() => ({ performance: solved / target }))` | the wiring test (`moduleResult(...)` must come from `./logic`) |
| A screen importing another module's screen | allowed: components may import components | `import { Gauge } from "../tanks/TanksModule"` | acceptable by design |
| The shared mission screens | `MissionScreen.js`, the two sheets and `kit.js` are not modules | `createRandom` in `DailyMissionSheet.js` (the day's durations) | reported by `--all`, informational only |
| A missing import after moving code | the screen still names something that now lives in `logic.js` | `altitudeSpec.load` used without importing it | launching the app, or a TypeScript/ESLint pass |
| Regex parsing | files are read as text, not parsed | an `export {` split over several lines may be misread | the files are regular; a misread shows as a missing module, not a silent pass |
| It does not run the app | `node_modules` is not needed | a runtime error in a component | a real flight |

## Try it: two ways to make it fail on purpose

No knowledge of the code is needed: open the file, change the one thing described, run the command, read the
result, then put the file back as it was.

**1. A module that re-declares its load in the screen (rule 1d).**

1. Open `src/missions/modules/altitude/AltitudeModule.js` and find the line near the end:
   `export const altitudeModule = { ...altitudeSpec, Component: AltitudeModule };`
2. Change it to `export const altitudeModule = { ...altitudeSpec, load: 5, Component: AltitudeModule };`
3. Run `npm run check:modules -- --details`.
4. Under `MULTITASKING`, `altitude` turns to `FAIL` with
   `the declaration of altitudeModule sets "load" itself; those fields belong to the spec in logic.js`, and the
   `GENERAL` line reads `1 OF 25 MODULES FAIL THE TEST`. The reason: the generator budgets missions from the
   specs in `logic.js`; a load written in the screen would be invisible to it.
5. Undo the change.

**2. A module that draws its own random numbers (rule 3c).**

1. Open `src/missions/modules/math-check/logic.js` and find the line `const correct = rnd.chance(0.5);`
2. Change it to `const correct = Math.random() < 0.5;`
3. Run `npm run check:modules -- --details`.
4. Under `MENTAL MATH`, `math-check` turns to `FAIL` with
   `logic.js: calls Math.random (line 32); generators must receive their random source as a parameter`.
   The reason: two players of the same daily mission would no longer see the same calculations.
5. Undo the change.
