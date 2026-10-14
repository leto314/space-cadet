import { SpatialBeaconGame } from "../games/spatial-beacon/SpatialBeaconGame";
import { DailyCubeRotation } from "../games/spatial-orientation/DailyCubeRotation";
import { TurnCountGame } from "../games/turn-count/TurnCountGame";
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
