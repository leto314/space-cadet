# check-game-separation

A check that every game of Space Cadet is split in two files: its **logic** (pure JavaScript) and its **screens**
(React). No knowledge of the app is needed to run it or to read its report.

## What it is about

Space Cadet is a cognitive training app with 20 games, each in its own folder `src/games/<game>/`. Every game
must be split in two:

| File | Contains | May import |
|---|---|---|
| `logic.js` | content generation (which questions, routes, grids...), scoring, the daily progression, the assembly of results | only `../../utils/random.js` (seeded randomness) or another game's `logic.js` |
| `<Name>Game.js` (and other screen files) | the screens: React components, animations, sounds, styles | anything, including `./logic` |

Why: the logic is what decides that every player gets the same daily game and how it is scored. Kept pure, it can
be loaded and tested with plain Node, without installing React Native. The split also keeps screen files small.

Randomness rule: screens never draw random numbers. They pick a **seed** (the day's seed, or `randomSeed()` for a
free session) and hand it to the logic, which turns it into a generator. Same seed -> same game, every time.

## How to run it

From the project folder, with Node 20 or newer. Nothing to install (no `npm install` needed).

```bash
node scripts/check-game-separation.mjs              # games with a daily version, PASS / FAIL per game (default)
node scripts/check-game-separation.mjs --details    # same, plus what is wrong in each failing game (file, line)
node scripts/check-game-separation.mjs --all        # every game, including those without a daily version yet
node scripts/check-game-separation.mjs --help
```

(`npm run check:separation` does the same once the project's dependencies are installed.)

The report shows one line per competence and per game, then a `GENERAL` verdict. Exit code is 0 when all games
with a daily version pass, 1 otherwise (so it can run in CI).

```
SPATIAL ORIENTATION                              PASS
  01 Cube Rotation            PASS
  06 Heading and Beacon       FAIL  (2 issues)
  ...
GENERAL
  1 OF 20 FINISHED GAMES FAIL THE TEST  (Heading and Beacon)
```

A game "has a daily version" when it is registered in `src/daily/registry.js`. Those must pass. The others are
reported as `NOT IN DAILY VERSION` and do not affect the verdict until they are split.

## What is checked

| # | Rule | Applies to | Example that FAILS | Example that PASSES |
|---|---|---|---|---|
| 1a | `logic.js` exists | `src/games/<game>/` | the folder only has `TurnCountGame.js` | `turn-count/logic.js` + `turn-count/TurnCountGame.js` |
| 1b | At least one screen file imports `./logic` | screen files | `logic.js` exists but nothing imports it | `import { buildSession } from "./logic";` |
| 1c | The daily registry points inside the game folder | `src/daily/registry.js` (daily games only) | registry imports from `../games/old-folder/...` | `import { TurnCountGame } from "../games/turn-count/TurnCountGame";` |
| 2a | No `Math.random` | every `.js` in the folder except `logic.js` | `const seed = Math.floor(Math.random() * 2 ** 32)` | `const seed = randomSeed();` (from `utils/random`) |
| 2b | No `createRandom` / `randomTools` | screen files | `buildRound(createRandom(seed))` in a component | `buildSession(settings, seed)` - the logic builds the generator |
| 2c | No `DAILY_*` constant declared | screen files | `const DAILY_STAGES = [...]` in a component | `import { DAILY_STAGES } from "./logic";` |
| 2d | Screen files export only React components (PascalCase names) | screen files | `export function buildDailyRounds(seed)`, `export const roundPoints` | `export function TurnCountGame()`, `export function NetView()` |
| 3a | `logic.js` imports only `../../utils/random.js` or another `logic.js` | `logic.js` | `import { SPACE_CADET } from "../../theme/spaceCadet"` | `import { createRandom } from "../../utils/random.js";` |
| 3b | Those imports carry the `.js` extension | `logic.js` | `from "../../utils/random"` (Node cannot resolve it) | `from "../../utils/random.js"` |
| 3c | `logic.js` never calls `Math.random` | `logic.js` | `function buildTrial(random = Math.random)` | `function buildTrial(mode, random)` |
| 3d | `logic.js` contains no JSX | `logic.js` | `return <View />;` | - |
| 3e | `logic.js` really loads in plain Node (`import()`) | `logic.js` | passes 3a-3d but throws at load time (`undefinedThing()`), or imports a file that itself imports React | loads, exports listed |

Notes:
- Rules 2a-2c and 3c ignore matches inside `//` comments.
- The game list, the competence names and the set of daily games are read from the app's own files
  (`src/data/exercises.js`, `src/theme/spaceCadet.js`, `src/daily/registry.js`). Nothing is hard-coded in the
  script: a newly registered daily game becomes strict automatically.

## What is NOT checked (known limits)

| Gap | Why it matters | Example that slips through | What covers it |
|---|---|---|---|
| Logic left in a screen file, **unexported** | rules 2a-2d only see random draws, `DAILY_*` names and exports | `function scoreOf(results) { ... }` declared and used inside `XGame.js` | manual review when a game is split |
| Logic in a screen file under another name | the `DAILY_` prefix is the only naming hook | `const STAGES = [...]`, `const POINTS_PER_ROUND = 100` | manual review |
| A screen importing from another game's **screen** file | allowed as long as the names are PascalCase | `import { NetView } from "../cube-nets/CubeNetsGame"` (exists today, on purpose) | acceptable: components importing components |
| Logic disguised with a PascalCase name | 2d trusts the name | `export function BuildSession()` would pass | naming convention |
| Pure geometry that is really about pixels in `logic.js` | rule 3 checks purity, not relevance | `CANVAS_WIDTH = 320` in Turn Count's logic (kept there on purpose: the routes are generated in that space) | judgment call per case |
| Block comments | only `//` comments are ignored | `/* uses Math.random */` in a screen file is flagged | trivial false positive, reword the comment |
| Regex parsing | files are read as text, not parsed | an `export {` split over several lines may be misread | the files are regular; a misread shows as a missing game/export, not a silent pass |
| **A missing import** after moving code | the screen still references a name that is now in `logic.js` but forgot to import it | `DAILY_STAGES.length` used in a screen without `import { DAILY_STAGES } from "./logic"` - the check says PASS, the app crashes | launching the app, or a TypeScript/ESLint pass |
| Seed discipline inside `logic.js` | 3c forbids `Math.random` but does not verify generators *use* the `random` they receive | `buildX(random) { return Date.now() % 7; }` | the correctness tests (same seed -> same output), next step |
| Behavioural equivalence | the check says nothing about whether a split changed the game | a moved function with an edited constant | comparing old vs. new output over several seeds (done by hand for each split so far) |
| It does not run the app | `node_modules` is not needed, so nothing is executed but the logic files | a runtime error in a screen | a manual run of the game |

## Try it: five ways to make it fail on purpose

Each example is a one-line change. Make it, run the check (with `--details` to see the message), then undo it.
The first three use Turn Count, whose files are `src/games/turn-count/logic.js` and
`src/games/turn-count/TurnCountGame.js`; the last two use the Logic games.

**1. A screen that draws its own random numbers (rule 2a).**
In `TurnCountGame.js`, find the line

```js
const [readyTrajectory, setReadyTrajectory] = useState(() => sampleTrajectory(randomSeed()));
```

and replace `randomSeed()` with `Math.random()`. Run the check: Turn Count fails with
`TurnCountGame.js: uses Math.random (line N); content must be drawn in logic.js from an explicit seed`.

**2. Logic that depends on React Native (rules 3a and 3e).**
At the top of `logic.js`, add the line

```js
import { View } from "react-native";
```

Run the check: Turn Count fails with `logic.js: imports "react-native" (line 1); only ../../utils/random.js or
another game's logic.js are allowed`. (Delete the line; then, to see rule 3e, add instead at the very end of
`logic.js` the line `export const boom = missingFunction();` - the file passes every text rule but fails to load:
`logic.js: does not load in Node (missingFunction is not defined)`.)

**3. Logic exported from a screen file (rule 2d).**
In `TurnCountGame.js`, find `function directionName(direction)` and put `export ` in front of it:

```js
export function directionName(direction) { return direction === "R" ? "RIGHT" : "LEFT"; }
```

Run the check: Turn Count fails with `TurnCountGame.js: exports "directionName" (line N), which is not a React
component; logic must be exported from logic.js`.

**4. A logic game that stops being reproducible (rule 3c).**
`src/games/switchboard/logic.js` builds the day's panels from the seed it is given. Find

```js
export function buildPanel({ lightCount, switchCount }, random) {
```

and give the generator a fallback of its own: `random = Math.random`. The code still runs - every caller passes a
seeded generator - but the door is open for the next one. Run the check: Switchboard fails with
`logic.js: calls Math.random (line N); generators must receive their random source as a parameter`, the `LOGIC`
line turns to `FAIL` and `GENERAL` reads `1 OF 20 FINISHED GAMES FAIL THE TEST (Switchboard)`.

**5. A helper exported from a logic game's screen (rule 2d).**
In `src/games/pattern-matrix/PatternMatrixGame.js`, find

```js
function formatSeconds(ms) { return (ms / 1000).toFixed(1); }
```

and put `export ` in front of it (as if a mission module wanted to reuse it). The check reports
`PatternMatrixGame.js: exports "formatSeconds" (line N), which is not a React component; logic must be exported
from logic.js`: shared helpers belong to `logic.js`, which the mission modules already import from several games.

In the first three cases the competence line (`SPATIAL ORIENTATION`) turns to `FAIL`, the `GENERAL` line reads
`1 OF 20 FINISHED GAMES FAIL THE TEST (Turn Count)`, and the exit code is 1. Undo the change and everything is
`PASS` again.
