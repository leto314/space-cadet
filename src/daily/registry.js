import { AirwaysGame } from "../games/airways/AirwaysGame";
import { ContinuousTotalGame } from "../games/continuous-total/ContinuousTotalGame";
import { CubeNetsGame } from "../games/cube-nets/CubeNetsGame";
import { EstimationGame } from "../games/estimation/EstimationGame";
import { MemorySpanGame } from "../games/memory-span/MemorySpanGame";
import { MentalMathGame } from "../games/mental-math/MentalMathGame";
import { MultitaskingGame } from "../games/multitasking/MultitaskingGame";
import { NBackGame } from "../games/n-back/NBackGame";
import { ReactionTimeGame } from "../games/reaction-time/ReactionTimeGame";
import { SelectiveAttentionGame } from "../games/selective-attention/SelectiveAttentionGame";
import { SpatialBeaconGame } from "../games/spatial-beacon/SpatialBeaconGame";
import { DailyCubeRotation } from "../games/spatial-orientation/DailyCubeRotation";
import { SymbolRadarGame } from "../games/symbol-radar/SymbolRadarGame";
import { TurnCountGame } from "../games/turn-count/TurnCountGame";
import { VisualGridMemoryGame } from "../games/visual-grid-memory/VisualGridMemoryGame";
import { VisualScanGame } from "../games/visual-scan/VisualScanGame";
import { createRandom, hashString, randomTools } from "../utils/random";

// The daily training: one game per competence each day, the same for everyone. A game joins the rotation once it
// has a daily version here. Each daily version declares its levels (null when the game sets its own progression,
// the same for everyone) and its Component, which receives { level, seed, onFinish, onExit } and calls
// onFinish({ score, metrics, trials }).

export const LEVELS = [
  { key: "simple", label: "SIMPLE" },
  { key: "standard", label: "STANDARD" },
  { key: "experienced", label: "EXPERIENCED" },
];

export const DAILY_GAMES = {
  "spatial-orientation": {
    competence: "spatial",
    title: "Cube Rotation",
    summary: "5 sets, slow to hidden",
    levels: null,
    progression: "Five sets of ten turns for everyone: one slow set with every turn shown, two quicker sets where one or two turns are only announced, then two where the cube stops after three or four turns.",
    rules: "Follow the marked face while the cube turns, then find where it ended up on the unfolded cube. Five sets of ten turns, harder as you go: some turns are only announced (picture them), and in the last sets the cube stops moving after the first turns. 200 points per set.",
    Component: DailyCubeRotation,
  },
  "spatial-beacon": {
    competence: "spatial",
    title: "Heading and Beacon",
    summary: "10 rounds in 3 stages",
    levels: null,
    progression: "Three stages for everyone: 3 rounds reading the heading, 3 placing the aircraft around the beacon, then 4 doing both.",
    rules: "Three stages of growing difficulty. Heading: pick the aircraft pointing like the gyro. Position: place the aircraft around the beacon. Both: pick the heading, then drag the aircraft from the beacon to its position (a simple tap also works: you then pick the position). 100 points per round.",
    Component: ({ seed, onFinish, onExit }) => <SpatialBeaconGame daily={{ seed, onFinish, onExit }} />,
  },
  "turn-count": {
    competence: "spatial",
    title: "Turn Count",
    summary: "5 routes, slow to fast",
    levels: null,
    progression: "Five routes for everyone: one slow, two at medium pace, two fast.",
    rules: "Follow the route as it draws itself and count only the turns in the requested direction. Five routes: one slow, two at medium pace, two fast. 200 points per right count.",
    Component: ({ seed, onFinish, onExit }) => <TurnCountGame daily={{ seed, onFinish, onExit }} />,
  },
  "cube-nets": {
    competence: "spatial",
    title: "Cube Nets",
    summary: "8 puzzles, easy to hard",
    levels: null,
    progression: "Eight puzzles for everyone, every exercise tested: three easy, three medium (net to cube, net to net, cube to net), then two hard (net to cube, cube to net).",
    rules: "A cube is shown unfolded, seen from the outside, with a character on each face; the way each character is turned matters. Net to cube: pick the cube the net folds into. Net to net: pick the other net that folds into the same cube. Cube to net: the same cube is shown from three corners, pick the net that makes it. Eight puzzles, easy to hard. 125 points per right answer.",
    Component: ({ seed, onFinish, onExit }) => <CubeNetsGame daily={{ seed, onFinish, onExit }} />,
  },
  "reaction-time": {
    competence: "attention",
    title: "Reaction Time",
    summary: "10 rounds, easy to hard",
    levels: null,
    progression: "Ten rounds for everyone: two easy (green only), three medium (a red signal may come first), five hard (four panels, the green may sit beside a red decoy).",
    rules: "Each round lights one green signal: tap it as fast as you can. Up to 100 points per round, fewer the slower the reaction, and 0 for a tap before the signal, on a red signal, on the wrong panel, or later than 2 seconds. Ten rounds: two easy, three medium, five hard.",
    Component: ({ seed, onFinish, onExit }) => <ReactionTimeGame daily={{ seed, onFinish, onExit }} />,
  },
  "symbol-radar": {
    competence: "attention",
    title: "Anomaly Detection",
    summary: "90 seconds, slow to fast",
    levels: null,
    progression: "Ninety seconds for everyone, the signals speeding up every thirty: slow, medium, then fast. About fifteen anomalies.",
    rules: "Watch the signal lines and tap a line only when it contains an octagon. An anomaly earns 1 point if caught in the first quarter of the screen, then 0.75, 0.5 and 0.25 by quarter, and costs 1 point if missed; each false alarm costs half a point. Ninety seconds, the signals speeding up every thirty. The score is the share of points earned, out of 1000.",
    Component: ({ seed, onFinish, onExit }) => <SymbolRadarGame daily={{ seed, onFinish, onExit }} />,
  },
  "selective-attention": {
    competence: "attention",
    title: "Selective Attention",
    summary: "10 trials, easy to hard",
    levels: null,
    progression: "Ten trials for everyone: two easy (the cue is shown first), two medium (a spoken colour joins the cues), six hard (the cue comes with the word).",
    rules: "Match the requested word, ink colour or spoken colour, ignoring the rest. A right answer scores up to 100 points, fewer the slower the response (when the cue is the spoken colour, the time it takes to hear it is not counted); a wrong answer, or none within 6 seconds, scores 0. Ten trials: two easy, two medium, six hard.",
    Component: ({ seed, onFinish, onExit }) => <SelectiveAttentionGame daily={{ seed, onFinish, onExit }} />,
  },
  "visual-scan": {
    competence: "attention",
    title: "Visual Scan",
    summary: "3 grids, 3 × 3 to 5 × 5",
    levels: null,
    progression: "Three grids for everyone, 3 × 3, 4 × 4 then 5 × 5. Each grid's characters (numbers, letters or both) and direction come from the day's seed.",
    rules: "Tap every character on the grid in order, as fast as you can. Each validated cell locks, and every wrong tap counts as an error. A grid scores up to 100 points, fewer the longer it takes, and each error costs a little more than the one before (a small grid forgives less). Three grids, 3 × 3 to 5 × 5.",
    Component: ({ seed, onFinish, onExit }) => <VisualScanGame daily={{ seed, onFinish, onExit }} />,
  },
  "mental-math": {
    competence: "mentalMath",
    title: "Flash Math",
    summary: "25 questions in 2 minutes",
    levels: null,
    progression: "A ladder of 25 questions in five stages of five for everyone: one operation (+ −), two operations (+ −), one operation (× ÷), two operations with all signs, then three. Two minutes on the clock.",
    rules: "Solve each expression and enter the result. Two minutes for a ladder of 25 questions that get harder stage by stage; a wrong answer moves on. 40 points per right answer.",
    Component: ({ seed, onFinish, onExit }) => <MentalMathGame daily={{ seed, onFinish, onExit }} />,
  },
  "continuous-total": {
    competence: "mentalMath",
    title: "Running Total",
    summary: "5 series, slow to fast",
    levels: null,
    progression: "Five series for everyone, longer and faster as they go: slow with + and −, slow with all signs, medium with + and −, medium with all signs, then fast with all signs. Worth 100, 150, 200, 250 and 300 points.",
    rules: "Keep a running total in your head as each operation appears, then enter the final total. Five series, from 5 to 10 steps, slow to fast; each is worth 100 to 300 points, all or nothing.",
    Component: ({ seed, onFinish, onExit }) => <ContinuousTotalGame daily={{ seed, onFinish, onExit }} />,
  },
  estimation: {
    competence: "mentalMath",
    title: "Estimation",
    summary: "12 estimates, every kind",
    levels: null,
    progression: "Twelve estimates for everyone: every kind once (products, quotients, percentages, sums, comparisons, percent changes, missing values, dot counts, angles) plus three more, in the day's order.",
    rules: "Type your estimate and enter it: up to 100 points each, full within a small band, then falling evenly to 0 at a band set per kind (dots and angles are more forgiving than a sum). Dots are shown for four seconds, then hidden. Fifteen seconds per estimate.",
    Component: ({ seed, onFinish, onExit }) => <EstimationGame daily={{ seed, onFinish, onExit }} />,
  },
  multitasking: {
    competence: "multitasking",
    title: "Target Drift",
    summary: "90 seconds, easy to hard",
    levels: null,
    progression: "Ninety seconds for everyone, harder every thirty: easy (visible target, gentle drift, six seconds per alert), medium (faster drift, shorter alerts), then hard (no target, rapid drift, three seconds per alert). The questions, the alerts and the drift come from the day's seed.",
    rules: "Three things at once: keep the marker centred with the drift control, answer the two prompts (tap RIGHT when the calculation is correct, or when a character appears twice in the sequence), and tap each alert before it times out. Ninety seconds, harder every thirty. Drift control is worth 400 points (full credit while the marker sits in the target ring, none past the outer ring), decisions 350 (right answers minus wrong ones, against an expected pace of about sixteen a minute), alerts 250 (the share handled in time).",
    Component: ({ seed, onFinish, onExit }) => <MultitaskingGame daily={{ seed, onFinish, onExit }} />,
  },
  "memory-span": {
    competence: "memory",
    title: "Memory Sequences",
    summary: "9 sequences, 4 to 9 long",
    levels: null,
    progression: "Nine sequences for everyone, longer and harder as they go: two with the digits on screen and the recall direction known in advance (4 then 5), three with the digits on screen but the direction revealed only at recall (5, 6, 7), then four spoken only, NATO letters among the digits (6, 7, 8, 9).",
    rules: "Memorize the sequence, then type it back in the requested direction (forward, or in reverse). Nine sequences, harder as you go: the digits stop being shown, and letters join in. Each sequence is worth an equal share of the 1000 points when it comes back exactly right, and half credit for the characters in the right place otherwise.",
    Component: ({ seed, onFinish, onExit }) => <MemorySpanGame daily={{ seed, onFinish, onExit }} />,
  },
  "n-back": {
    competence: "memory",
    title: "N-back",
    summary: "3 blocks, 2-back then harder",
    levels: null,
    progression: "Three blocks for everyone: the spoken characters in 2-back (20 trials), the lit square's position in 2-back (25 trials), then the day's hard block of 25 trials: both streams at once in 2-back, or a single stream in 3-back, depending on the day.",
    rules: "Mark a match when the item repeats the one from N steps earlier. Three blocks: characters (spoken) in 2-back, positions (the lit square) in 2-back, then the day's hard block: both at once with one control each, or one stream in 3-back. A block scores its share of the matches caught minus the share of false alarms, so tapping everything earns nothing: 300 points for the characters, 300 for the positions, 400 for the hard block.",
    Component: ({ seed, onFinish, onExit }) => <NBackGame daily={{ seed, onFinish, onExit }} />,
  },
  "visual-grid-memory": {
    competence: "memory",
    title: "Visual Memory",
    summary: "3 ladders, 3 cells up",
    levels: null,
    progression: "Three ladders for everyone, each starting at three cells and gaining one cell per success until a mistake: a plain 4 × 4 grid, then a 5 × 5 grid recalled in order or seen through decoy patterns (depending on the day), then a 5 × 5 grid that turns a quarter before recall or a 6 × 6 grid recalled in order (depending on the day).",
    rules: "Memorize the highlighted cells, then find them again on the empty grid. Each ladder starts at three cells and adds one at every success; the first mistake ends it. A ladder is worth about a third of the points, in full at eight cells on the plain grid, seven through decoys or when the grid turns, six when the order matters.",
    Component: ({ seed, onFinish, onExit }) => <VisualGridMemoryGame daily={{ seed, onFinish, onExit }} />,
  },
  airways: {
    competence: "multitasking",
    title: "Airways",
    summary: "90 seconds, slow to fast",
    levels: null,
    progression: "Ninety seconds for everyone, the traffic speeding up every thirty: slow, medium, then fast. The traffic comes from the day's seed.",
    rules: "Keep the shaded sectors from saturating: a sector may hold at most four aircraft, including at most two blue ones. Clear a lane with its button, or every aircraft of a colour with the wide buttons. Ninety seconds, faster every thirty. An overload does not end the session: the sector is emptied and the traffic resumes. Safety is worth 600 points (200 lost per overload), efficiency 400 (each reroute made while the sector was not under threat, fewer than three aircraft in its zone and none about to overload it, costs a twelfth; efficiency counts once you have made a needed reroute).",
    Component: ({ seed, onFinish, onExit }) => <AirwaysGame daily={{ seed, onFinish, onExit }} />,
  },
};

const DAY_MS = 86400000;
const dayNumber = (dayKey) => Math.round(Date.parse(`${dayKey}T00:00:00Z`) / DAY_MS);

// Which game of a competence is played on a given day. Days go by in blocks as long as the list of games: each
// block is a seeded shuffle of the list, and a block never starts with the game that ended the previous one, so
// the same game never comes twice in a row (when there are at least two).
export function dailyGameFor(competence, dayKey) {
  const keys = Object.keys(DAILY_GAMES).filter((key) => DAILY_GAMES[key].competence === competence).sort();
  if (keys.length <= 1) return keys[0] ?? null;
  const day = dayNumber(dayKey);
  if (keys.length === 2) return keys[day % 2];
  const blockOf = (block) => {
    const order = randomTools(createRandom(hashString(`daily-lineup:${competence}:${block}`))).shuffle(keys);
    return order;
  };
  const block = Math.floor(day / keys.length);
  const order = blockOf(block);
  if (order[0] === blockOf(block - 1).at(-1)) [order[0], order[1]] = [order[1], order[0]];
  return order[day - block * keys.length];
}

// The content seed of a daily game: the same for every player of the same day and level.
export function dailyGameSeed(gameKey, dayKey, level) {
  return hashString(`space-cadet:daily:${dayKey}:${gameKey}:${level}`);
}
