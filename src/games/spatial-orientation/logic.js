// Cube Rotation: the logic. Pure JavaScript (no React, no React Native): the cube's rotation maths, the turn
// sequences, the daily progression and the daily score. Every generator takes `random` (a Math.random-like
// function, see utils/random.js) so the same seed always gives the same turns.

import { createRandom, deriveSeed, randomTools } from "../../utils/random.js";

// Full Clearance difficulties: how long a turn takes and the pause after it, and whether the cube is shown turning
// (on "hard" the turns are only announced).
export const DIFFICULTY_OPTIONS = [
  { key: "easy", label: "Easy", rotationMs: 1100, pauseMs: 1500, visual: true },
  { key: "medium", label: "Medium", rotationMs: 660, pauseMs: 780, visual: true },
  { key: "hard", label: "Hard", rotationMs: 760, pauseMs: 900, visual: false },
];

// Where each face of the cube sits at the start: position → face.
export const START_ORIENTATION = { front: "front", back: "back", left: "left", right: "right", top: "top", bottom: "bottom" };

export const identityMatrix = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

const answerLabels = {
  top: "top",
  left: "left",
  front: "front",
  right: "right",
  bottom: "bottom",
  back: "back",
};

export function easeInOut(progress) {
  return 0.5 - Math.cos(Math.PI * progress) / 2;
}

function degreesToRadians(value) {
  return (value * Math.PI) / 180;
}

export function multiplyMatrices(left, right) {
  return [
    [
      left[0][0] * right[0][0] + left[0][1] * right[1][0] + left[0][2] * right[2][0],
      left[0][0] * right[0][1] + left[0][1] * right[1][1] + left[0][2] * right[2][1],
      left[0][0] * right[0][2] + left[0][1] * right[1][2] + left[0][2] * right[2][2],
    ],
    [
      left[1][0] * right[0][0] + left[1][1] * right[1][0] + left[1][2] * right[2][0],
      left[1][0] * right[0][1] + left[1][1] * right[1][1] + left[1][2] * right[2][1],
      left[1][0] * right[0][2] + left[1][1] * right[1][2] + left[1][2] * right[2][2],
    ],
    [
      left[2][0] * right[0][0] + left[2][1] * right[1][0] + left[2][2] * right[2][0],
      left[2][0] * right[0][1] + left[2][1] * right[1][1] + left[2][2] * right[2][1],
      left[2][0] * right[0][2] + left[2][1] * right[1][2] + left[2][2] * right[2][2],
    ],
  ];
}

export function buildRotationMatrix(axis, degrees) {
  const radians = degreesToRadians(degrees);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  if (axis === "x") {
    return [
      [1, 0, 0],
      [0, cos, -sin],
      [0, sin, cos],
    ];
  }

  if (axis === "y") {
    return [
      [cos, 0, sin],
      [0, 1, 0],
      [-sin, 0, cos],
    ];
  }

  return [
    [cos, -sin, 0],
    [sin, cos, 0],
    [0, 0, 1],
  ];
}

function snapValue(value) {
  if (Math.abs(value) < 0.0001) {
    return 0;
  }

  if (Math.abs(value - 1) < 0.0001) {
    return 1;
  }

  if (Math.abs(value + 1) < 0.0001) {
    return -1;
  }

  return value;
}

export function snapMatrix(matrix) {
  return matrix.map((row) => row.map((value) => snapValue(value)));
}

// A sequence of `turns` turns, never a turn immediately undone by the next one.
export function buildSequence(turns, random) {
  const axes = ["x", "y", "z"];
  const sequence = [];
  let previous = null;
  for (let index = 0; index < turns; index += 1) {
    let next = null;
    while (!next || (previous && previous.axis === next.axis && previous.direction === -next.direction)) {
      next = { axis: axes[Math.floor(random() * axes.length)], direction: random() > 0.5 ? 1 : -1 };
    }
    sequence.push(next);
    previous = next;
  }
  return sequence;
}

// A Full Clearance run: `moveCount` turns from a seed.
export function buildRun({ moveCount }, seed) {
  return buildSequence(moveCount, createRandom(seed));
}

export function rotateOrientation(orientation, axis, direction) {
  if (axis === "y") {
    if (direction === 1) {
      return {
        front: orientation.left,
        right: orientation.front,
        back: orientation.right,
        left: orientation.back,
        top: orientation.top,
        bottom: orientation.bottom,
      };
    }

    return {
      front: orientation.right,
      right: orientation.back,
      back: orientation.left,
      left: orientation.front,
      top: orientation.top,
      bottom: orientation.bottom,
    };
  }

  if (axis === "z") {
    if (direction === 1) {
      return {
        front: orientation.front,
        back: orientation.back,
        top: orientation.right,
        left: orientation.top,
        bottom: orientation.left,
        right: orientation.bottom,
      };
    }

    return {
      front: orientation.front,
      back: orientation.back,
      top: orientation.left,
      left: orientation.bottom,
      bottom: orientation.right,
      right: orientation.top,
    };
  }

  if (direction === 1) {
    return {
      front: orientation.top,
      top: orientation.back,
      back: orientation.bottom,
      bottom: orientation.front,
      left: orientation.left,
      right: orientation.right,
    };
  }

  return {
    front: orientation.bottom,
    top: orientation.front,
    back: orientation.top,
    bottom: orientation.back,
    left: orientation.left,
    right: orientation.right,
  };
}

export function getTrackedFacePosition(orientation, trackedFace) {
  return Object.keys(orientation).find((position) => orientation[position] === trackedFace);
}

export function getAnswerLabel(answerKey) {
  return answerLabels[answerKey] ?? answerKey;
}

export function getVoiceLabel(turn) {
  if (turn.axis === "y") {
    return turn.direction === 1 ? "right" : "left";
  }

  if (turn.axis === "x") {
    return turn.direction === 1 ? "down" : "up";
  }

  return turn.direction === 1 ? "counterclockwise" : "clockwise";
}

// Daily training: five sets of ten turns of growing difficulty, the same for everyone. "Hidden" turns are
// announced by the voice but the cube does not move: the player pictures them. (The cube's faces all look alike
// while it turns, so a skipped animation never shows a wrong state.)
//   set 1        slow, every turn shown
//   sets 2–3     quicker; one or two turns (never the first) only announced
//   sets 4–5     quicker; the first 3 or 4 turns are shown, then the cube stays still until the end of the set
export const DAILY_TURNS = 10;
const SLOW = { rotationMs: 950, pauseMs: 1250 };
const QUICK = { rotationMs: 800, pauseMs: 950 };
const hideSome = (rnd) => rnd.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, rnd.int(1, 2));
const hideTail = (rnd) => { const from = rnd.int(3, 4); return Array.from({ length: DAILY_TURNS - from }, (_, index) => from + index); };
export const DAILY_SETS = [
  { ...SLOW, hidden: () => [], label: "SLOW" },
  { ...QUICK, hidden: hideSome, label: "SOME TURNS HIDDEN" },
  { ...QUICK, hidden: hideSome, label: "SOME TURNS HIDDEN" },
  { ...QUICK, hidden: hideTail, label: "FINISH IN YOUR HEAD" },
  { ...QUICK, hidden: hideTail, label: "FINISH IN YOUR HEAD" },
];

// One daily set: its ten turns, each flagged hidden or not. Each set has its own stream derived from the seed.
export function buildDailySet(seed, index) {
  const rnd = randomTools(createRandom(deriveSeed(seed, `set-${index}`)));
  const turns = [];
  for (let turn = 0; turn < DAILY_TURNS; turn += 1) {
    let next;
    do next = { axis: rnd.item(["x", "y", "z"]), direction: rnd.item([1, -1]) };
    while (turns.length && turns.at(-1).axis === next.axis && turns.at(-1).direction === -next.direction);
    turns.push(next);
  }
  const hidden = DAILY_SETS[index].hidden(rnd);
  return turns.map((turn, position) => ({ ...turn, hidden: hidden.includes(position) }));
}

// The daily result from the trials ([{ ok, ms, answer, expected, hidden }]): a score out of 1000 (200 per set
// found), the metrics recorded, and the trials.
export function dailyResult(trials) {
  const correct = trials.filter((trial) => trial.ok).length;
  const times = trials.map((trial) => trial.ms);
  return {
    score: Math.round((correct / DAILY_SETS.length) * 1000),
    metrics: { correct, sets: DAILY_SETS.length, turnsPerSet: DAILY_TURNS, meanAnswerMs: Math.round(times.reduce((sum, value) => sum + value, 0) / times.length), hiddenTurns: trials.reduce((sum, trial) => sum + trial.hidden, 0) },
    trials,
  };
}
