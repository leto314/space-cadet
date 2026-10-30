# Game logic tests

Tests of the **correctness** of a game's logic (`src/games/<game>/logic.js`): that the daily version is the same
for everyone with the same seed, different on different seeds, that its content is valid, that its score stays
between 0 and 1000 and moves the right way. They complement `scripts/check-game-separation.mjs`, which checks the
*structure* (logic and screens in separate files) but says nothing about what the logic does.

Games covered so far: **Target Drift** (`multitasking.test.mjs`), **Airways** (`airways.test.mjs`),
**Memory Sequences** (`memory-span.test.mjs`), **N-back** (`n-back.test.mjs`), **Visual Memory**
(`visual-grid-memory.test.mjs`) and the four Logic games, **Switchboard** (`switchboard.test.mjs`), **Landing
Order** (`landing-order.test.mjs`), **Pattern Matrix** (`pattern-matrix.test.mjs`) and **Circuits**
(`circuits.test.mjs`), plus a `wiring.test.mjs` that checks the lines connecting screens and the daily registry
to the logic (its `GAMES` list names the games it covers; the Logic screens follow the same contract,
`buildDailySession(daily.seed)` and `daily.onFinish(dailyResult(...))`, so they can be added to it).

`no-repeats.test.mjs` covers eleven games at once: within one session, daily or Full Clearance, the same
question never comes twice. What "the same question" means is set game by game in its `GAMES` list (in Flash
Math, the first calculation: "14 × 12", "12 × 14" and "(14 × 12) + 30" are one question). The generators avoid
repeats through `drawFresh` (`src/utils/random.js`), which draws again when a question was already asked; a
small pool is used up before anything comes back. Games built on repetition
(N-back, Reaction Time, Selective Attention, Anomaly Detection, Airways, Target Drift, Visual Memory) and Cube
Rotation and Visual Scan are left out on purpose; the file's header says why.

## How to run

From the project folder, Node 20 or newer, nothing to install:

```bash
npm run test:games                        # every test on one line, PASS or FAIL (compact, the default)
npm run test:games -- --details           # same, plus the failure message under each failing test
npm run test:games -- --only=airways      # one game only (the file's name without .test.mjs)
npm run test:games -- --no-color
npm run test:games -- --help
```

(`node scripts/run-tests.mjs games [options]` is the same command without npm. The runner and its reporter,
`scripts/test-reporter.mjs`, are shared with `npm run test:missions`; the original `scripts/games/reporter.mjs`
still works with Node's own `--test-reporter` option.) The output is plain ASCII, so it reads the same on any
terminal: one `[PASS]` / `[FAIL]` line per test under its suite, the list of failed tests, a `RESULT` line, then
the options. With `--details`, the failure message appears under each failing test, as below. The exit code is 1
when anything fails.

```
Airways - daily score
  [PASS] the weights add up to 1000
  [PASS] a clean session scores 1000, an idle one 0
  [FAIL] each overload costs its share, each extra reroute its twelfth
         Expected values to be strictly equal:

         450 !== 0

------------------------------------------------------------
FAILED TESTS:
  - each overload costs its share, each extra reroute its twelfth (scripts/games/airways.test.mjs:171)

RESULT: 83 tests, 82 passed, 1 failed  ->  FAIL
```

(Node's own reporters remain available, e.g. `--test-reporter=tap` or `spec`, if you prefer them.)

## What is checked

| Theme | Target Drift | Airways |
|---|---|---|
| **Same seed -> same game**, across several runs | the question, alert, drift and jitter streams of 8 seeds, 3 runs each | the traffic of 8 seeds over 120 ticks, 3 runs each |
| **Different seeds -> different games** | every pair of the 8 seeds gives different questions and alerts | every pair gives different traffic |
| **Streams are independent** | drawing more questions does not change the alerts | - |
| **Content is valid** | a calculation flagged "right" really is right (and "wrong" really wrong), about half of each; a sequence has 6 characters and exactly one repeat when it says so, about half of each; alert waits stay in the preset's range and keys among those offered; drift and jitter stay within the preset's strength | at most 2 spawns per tick, never in a lane with an aircraft entering, at the lane's entry row, unique ids, all three spawn counts occur; risk zones match what the screen shades; `advance` moves one row and drops off-board aircraft; an overload is declared exactly past the limits; a reroute is "necessary" exactly when defined (one below the limit, at the blue limit, or an overload coming within 3 ticks) |
| **The game demands play** | - | nobody acting always overloads; a careful simulated player never does, with no "extra" actions |
| **Progression** | 3 x 30 s, easy -> medium -> hard, `stageAt` right every second and `null` at 90; stages get harder (drift up, alert deadline down, target hidden last); Full Clearance has one stage of the chosen length | 3 x 30 s, slow -> medium -> fast, shorter tick per pace; Full Clearance one stage |
| **Score 0-1000** | weights add up to 1000; perfect -> 1000, idle -> 0; 2000 random stat combinations plus the extremes never leave 0-1000 and no part exceeds its weight | weights add up to 1000; clean -> 1000, overloads without action -> 0; each overload costs 200, each extra reroute a twelfth of 400, both parts floor at 0; 2000 random combinations never leave 0-1000 |
| **Score moves the right way** | more right answers never lower it, more missed alerts or wrong answers lower it, better drift control raises it; drift credit is 1 inside the target ring, 0 past the danger ring, decreasing between | - |
| **Full Clearance summary** | accuracy and mean distance in percent | efficiency in percent, 0 after an overload |
| **Wiring** (text check of React files) | registered under the Multitasking competence with title, summary, progression and rules; the screen imports `./logic`, builds its daily content from `daily.seed`, reports `daily.onFinish(dailyResult(...))`, leaves through `daily.onExit` | same |

The three memory games are checked the same way:

| Theme | Memory Sequences | N-back | Visual Memory |
|---|---|---|---|
| **Same seed -> same game** / **different seeds differ** | the nine sequences of 8 seeds, 3 runs each | the three blocks' streams (and the day's hard variant) | the day's three ladders and their patterns |
| **Content is valid** | each sequence has its step's length and preset; every character has the right spoken word; digits only where letters are not allowed; letters stay a minority (20-45 %) of the hard sequences; both recall directions occur | streams come from the right pool, of the right length, and none is built for a channel the block does not play; every repeat at distance N is a planted match; the block's minimum to two more matches per stream, always between a fifth and a half of the trials; the hard block is always two streams or 3-back, all three variants come up over 60 days; two streams at once leave more time between items | every pattern has the right number of distinct cells, all inside its grid; decoy frames only on the decoy ladder and never the pattern itself; the turning ladder turns both ways over the days; all four ladder combinations come up over 80 days; the same ladder step differs from day to day |
| **Progression** | nine sequences, easy -> medium -> hard, growing inside each preset, the hard ones 6 to 9 long; equal points each | characters 2-back (20 trials), positions 2-back (25), then the day's hard block (25): both streams in 2-back, or one stream in 3-back; weights 300/300/400 | a plain 4 x 4, then order or decoys on 5 x 5, then the grid turning on 5 x 5 or order on 6 x 6 (the grid only turns in the last stage); each pick's weights add up to 1000; a harder ladder asks for a shorter full span |
| **Judging an answer** | exact, partly right, reversed and empty answers | a channel's share is corrected for guessing | a ladder pays from its starting span to its full span, then stops |
| **Score 0-1000** | all exact -> 1000, nothing -> 0; 800 fuzzed answer sets stay in range | everything caught -> 1000, nothing -> 0, **tapping every trial -> 0**; 1500 fuzzed cases | full spans -> 1000, failing the first pattern -> 0, whatever the day's pick; 1000 fuzzed cases |
| **Score moves the right way** | more right positions never lower it; an exact answer beats a near miss | more matches caught raise it, false alarms lower it | a longer span never lowers it |

The four Logic games are checked the same way:

| Theme | Switchboard | Landing Order | Pattern Matrix | Circuits |
|---|---|---|---|---|
| **Same seed -> same game** / **different seeds differ** | the five panels of 8 seeds, 3 runs each | the eight scenarios (names, order, clues, question) | the eight matrices | the six circuits |
| **Content is valid** | the shortest route really lights the target in `optimal` moves and no shorter route exists (breadth-first check); at least one toggle, distinct wirings, every light on the panel | every clue is true; the clues leave exactly one answer, which is the recorded one; no clue can be spared; no clue twice; the answer is among the options; sentences name real aircraft; every question kind comes up over 40 days | eight panels; the answer among distinct options at `answerIndex`; every entity inside its layout and domains, counts and masks agreeing; where options differ, the answer's value is never held by more than half of them (I-RAVEN), and they differ on at least two attributes; easy matrices keep to the simple layouts | sources below, NOT with one input, no dead bulb, every node feeding something; predict: the target is what the switches produce; missing gate: exactly one offered gate works and it is the real one; set the switches: few solutions, none all-off, `minFlips` is really the fewest |
| **Progression** | five panels, wiring shown then hidden, lights and switches never fewer, at most 5 lights and 4 switches; a hidden wiring is revealed after twice the shortest route, par = shortest route + the moves before the reveal, cap = twice par + 2 | eight scenarios, 3 to 6 aircraft, visible briefings first then memorised, 125 each | eight matrices easy -> hard, four options then six, 125 each | six circuits, every mode, boards and gate sets never shrinking, basic gates first, all seven last, switch-setting last |
| **Full Clearance session** | one panel with the chosen settings; `buildPanel` draws only from the generator it is given (the mission module shares one stream) | the requested scenarios with the chosen aircraft; same for `buildScenario` | the requested matrices at the chosen difficulty (`levelForIndex`) | the requested circuits in the chosen mode and gate set; mixed draws every mode from the seed; free switch-setting sessions draw every board size |
| **Score 0-1000** | 100 within par, a quarter at the cap, 0 unsolved; all at par -> 1000, nothing -> 0; 800 fuzzed cases | all right -> 1000, none -> 0, 3 right -> 375; 300 fuzzed cases | all right -> 1000, none -> 0, half -> 500; 300 fuzzed cases | all or nothing for predict and missing gate, the switch budget like Switchboard's; perfect -> 1000, nothing -> 0; 600 fuzzed cases |
| **Score moves the right way** | one more solve never lowers it, extra moves never raise it | one more right answer never lowers it | same | one more solve never lowers it, extra flips never raise it |

What is **not** covered: anything that happens on screen (timers, taps, the joystick, what is drawn), the feel of
the pacing, and whether the score thresholds are well calibrated for humans. Those need a real run of the game.

## Try it: make a test fail on purpose

Each change is one line. Make it, run the tests, read the failure, undo it.

**1. Logic - a score part worth more than its weight** - `src/games/multitasking/logic.js`, find

```js
export const DAILY_WEIGHTS = { drift: 400, decisions: 350, alerts: 250 };
```

and change `drift: 400` to `drift: 500`. Fails: `Target Drift - daily score > the weights add up to 1000`
(`1100 !== 1000`). Note that `the score never leaves 0-1000` still passes: `dailyResult` clamps the total, so a
perfect session scores 1000 and not 1100. The weights test exists precisely because the clamp would hide this.

**2. Logic - everyone gets the same game whatever the day** - `src/games/airways/logic.js`, in `createSession`,
find

```js
const rnd = randomTools(createRandom(deriveSeed(seed, "traffic")));
```

and replace `seed` with `1`. Fails: `Airways - daily session traffic > different seeds give different traffic`
(`seeds 1 and 2 give the same traffic`). The "same seed" test still passes: determinism is not the same thing as
variety, which is why both are tested.

**3. Logic - a question that lies** - `src/games/multitasking/logic.js`, in `buildMathQuestion`, find

```js
return { text: `${left} ${operation} ${right} = ${isTrue ? result : result + rnd.item([...])}`, isTrue };
```

and replace `isTrue ? result : result + rnd.item([...])` with just `result` (every equation shown is now
correct, but half are still flagged wrong). Fails: `calculations are right when they say they are...` with the
offending equation in the message, e.g. `"43 + 12 = 55" is flagged false but the result is 55`.

**4. Logic - a scoring rule drifts** - `src/games/airways/logic.js`, find `export const INCIDENT_COST = 200;` and
change it to `150`. Fails: `each overload costs its share...` (three overloads no longer use up the 600 safety
points: `450 !== 0`). Now change it to `250` instead: **nothing fails**. The tests check the rule against its
own constant (one overload costs `INCIDENT_COST`, the safety part floors at 0) and the bounds, not the number
200 itself, which is a tuning decision that may legitimately change. If a value must never change, pin it in a
test on purpose.

**5. Game file - the screen stops reporting the logic's score** - `src/games/airways/AirwaysGame.js`, in
`finishGame`, find

```js
if (daily) { daily.onFinish(dailyResult(statsRef.current)); return; }
```

and replace `dailyResult(statsRef.current)` with `{ score: 1000, metrics: {} }`. Fails:
`Airways - wiring > the screen builds the day's session from the seed and reports the logic's daily result`.
(The separation check would not notice this one: the file is still well structured. Conversely, these tests do
not notice a `Math.random` added to a screen; that is the separation check's job.)

**6. Registry - a game filed under the wrong competence** - `src/daily/registry.js`, in the `airways` entry,
change `competence: "multitasking"` to `competence: "memory"`. Fails: `Airways - wiring > is registered as a
daily game of its competence...`.

**7. Logic - a daily game that is suddenly trivial** - `src/games/n-back/logic.js`, find
`export const DAILY_TARGET_SHARE = 1 / 3;` and change it to `2 / 3`. Fails: `N-back - daily blocks > every stream plants
its matches...` with `seed 1, audio/audio: more than half the trials are matches` - the block would no longer test
anything. (The range part of that test is written against the constant itself, so it is the "under half" rule
that catches this.)

**8. Logic - a puzzle that becomes a guess** - `src/games/circuits/logic.js`, in `generate`, find

```js
      if (working.length !== 1) continue;
```

and relax it to `if (working.length < 1) continue;` (the missing gate now only has to be *a* gate that works, not
the only one). Fails: `Circuits - daily circuits > missing gate: exactly one offered gate lights the target, and
it is the real one` with `seed 1: 4 options light the target` - every option would close the circuit, so the
puzzle would reward guessing instead of reasoning. Note that determinism, the gate sets and the scoring all still
pass: only the test written against the rule itself notices.

**9. Logic - a briefing that gives the answer away** - `src/games/landing-order/logic.js`, in `buildScenario`,
comment out the line that strips the clues which are not needed:

```js
      if (answersFor(candidatesFor(without, count), question).size === 1) clues = without;
```

Fails: `Landing Order - daily scenarios > every clue is true, the clues pin the answer down to exactly one, and no
clue can be spared` with, for example, `seed 1, 3 aircraft: clue "{A} lands immediately before {B}." is not
needed`. A scenario with spare clues is not wrong, only easier than it claims: a player can skip a line and still
deduce the answer.

## Adding a game

Copy one of the two test files, point it at the new `logic.js`, and keep the same themes: determinism, variety,
valid content, progression, score bounds and direction. Add the game to the `GAMES` list of `wiring.test.mjs`,
and, if its questions should never repeat in a session, to the `GAMES` list of `no-repeats.test.mjs`.
The `helpers.mjs` file provides the seeds, `same`, `assertScore` and `fuzz`.
