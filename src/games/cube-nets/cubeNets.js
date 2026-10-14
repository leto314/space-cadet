// Pure logic for the Cube Nets game: folding nets, comparing cubes, building puzzles. No React in here.
//
// Conventions: 3D vectors are [x, y, z]. A net is drawn flat and seen from OUTSIDE the cube, so folding pushes the
// neighbouring faces away from the viewer. Every net cell carries a frame { n, r, u }: the outward normal of its
// face and where the cell's "right" and "up" point once folded (r × u = n). A glyph drawn in a cell is turned
// clockwise by k quarter turns; on the cube it is stored as the 3D direction its top points to.

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const neg = (a) => [-a[0], -a[1], -a[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const key = (v) => v.join(",");
const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// The four directions a glyph's top can point to on a face, indexed by clockwise quarter turns from "up".
const glyphDirections = (frame) => [frame.u, frame.r, neg(frame.u), neg(frame.r)];
const frameOf = (n, u) => ({ n, u, r: cross(u, n) });
// All 24 ways to hold the cube.
export const FRAMES = AXES.flatMap((n) => AXES.filter((u) => dot(u, n) === 0).map((u) => frameOf(n, u)));

// Glyphs have no rotational symmetry, so each of their four orientations is recognisable. Stroke paths on a
// 10 × 10 box (y down).
export const GLYPHS = {
  F: "M3 9 L3 1 L8 1 M3 5 L7 5",
  L: "M3 1 L3 9 L8 9",
  E: "M8 1 L3 1 L3 9 L8 9 M3 5 L7 5",
  T: "M2 1 L8 1 M5 1 L5 9",
  A: "M2 9 L5 1 L8 9 M3.2 6 L6.8 6",
  K: "M3 1 L3 9 M8 1 L3 5.5 L8 9",
  Y: "M2 1 L5 5 L8 1 M5 5 L5 9",
  P: "M3 9 L3 1 L6 1 C9 1 9 5 6 5 L3 5",
  R: "M3 9 L3 1 L6 1 C9 1 9 5 6 5 L3 5 M6 5 L8.5 9",
  J: "M4 1 L7.5 1 M7 1 L7 6.5 C7 9.8 2.5 9.8 2.5 6.5",
  G: "M8 3 C6.5 0.3 2 0.8 2 5 C2 9.2 6.5 9.8 8 7 L8 5 L5.5 5",
  2: "M2.5 3 C2.5 0.3 8 0.3 7.5 3.5 C7.2 5.5 2.5 7.5 2.5 9 L8 9",
  4: "M6.5 9 L6.5 1 L2 6.5 L8.5 6.5",
  5: "M7.5 1 L3 1 L3 4.5 C8 3.5 9 9 5 9 C3.5 9 2.5 8.2 2.2 7.5",
  7: "M2.5 1 L8 1 L4.5 9",
};
const GLYPH_NAMES = Object.keys(GLYPHS);

// The 11 nets of a cube, as [x, y] cells (y down).
const BASE_SHAPES = [
  [[1, 0], [0, 1], [1, 1], [2, 1], [3, 1], [1, 2]],
  [[0, 0], [0, 1], [1, 1], [2, 1], [3, 1], [0, 2]],
  [[0, 0], [0, 1], [1, 1], [2, 1], [3, 1], [1, 2]],
  [[0, 0], [0, 1], [1, 1], [2, 1], [3, 1], [2, 2]],
  [[0, 0], [0, 1], [1, 1], [2, 1], [3, 1], [3, 2]],
  [[1, 0], [0, 1], [1, 1], [2, 1], [3, 1], [2, 2]],
  [[0, 0], [1, 0], [1, 1], [2, 1], [3, 1], [1, 2]],
  [[0, 0], [1, 0], [1, 1], [2, 1], [3, 1], [2, 2]],
  [[0, 0], [1, 0], [1, 1], [2, 1], [3, 1], [3, 2]],
  [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2]],
  [[0, 0], [1, 0], [2, 0], [2, 1], [3, 1], [4, 1]],
];

// Walks the net from its first cell, folding at every shared edge, and returns each cell's frame.
function foldFrames(cells, start) {
  const frames = new Array(cells.length).fill(null);
  frames[0] = start;
  const queue = [0];
  while (queue.length) {
    const index = queue.shift();
    const { n, r, u } = frames[index];
    const [x, y] = cells[index];
    const steps = [
      [1, 0, { n: r, r: neg(n), u }], [-1, 0, { n: neg(r), r: n, u }],
      [0, -1, { n: u, r, u: neg(n) }], [0, 1, { n: neg(u), r, u: n }],
    ];
    steps.forEach(([dx, dy, frame]) => {
      const next = cells.findIndex((cell) => cell[0] === x + dx && cell[1] === y + dy);
      if (next >= 0 && !frames[next]) { frames[next] = frame; queue.push(next); }
    });
  }
  return frames;
}
export function isValidNet(cells) {
  const frames = foldFrames(cells, FRAMES[0]);
  return frames.every(Boolean) && new Set(frames.map((frame) => key(frame.n))).size === 6;
}
export const SHAPES = BASE_SHAPES.filter(isValidNet);

function transformShape(cells, turns, mirror) {
  let result = cells.map(([x, y]) => (mirror ? [-x, y] : [x, y]));
  for (let turn = 0; turn < turns; turn += 1) result = result.map(([x, y]) => [-y, x]);
  const minX = Math.min(...result.map((cell) => cell[0]));
  const minY = Math.min(...result.map((cell) => cell[1]));
  return result.map(([x, y]) => [x - minX, y - minY]);
}

// A cube is a map: face normal → { glyph, up } (up = where the top of the glyph points, in 3D).
function cubeFromNet(net) {
  const cube = {};
  foldFrames(net.cells, FRAMES[0]).forEach((frame, index) => { cube[key(frame.n)] = { glyph: net.faces[index].glyph, up: glyphDirections(frame)[net.faces[index].turn] }; });
  return cube;
}
// Unfolds a cube onto a given shape, starting from a given way of holding it.
function netFromCube(cube, cells, start) {
  const faces = foldFrames(cells, start).map((frame) => {
    const face = cube[key(frame.n)];
    return { glyph: face.glyph, turn: glyphDirections(frame).findIndex((direction) => same(direction, face.up)) };
  });
  return { cells, faces };
}
// Two cubes are the same object (up to how you hold them) exactly when their signatures match.
function cubeSignature(cube) {
  return FRAMES.map((frame) => netFromCube(cube, SHAPES[0], frame).faces.map((face) => face.glyph + face.turn).join("")).sort()[0];
}

// A corner view shows three faces: top, left and right. Drawn in view coordinates (x → right face, y → top,
// z → left face), each slot holds { glyph, turn } relative to that slot's own frame.
export const VIEW_SLOTS = [frameOf([0, 1, 0], [0, 0, -1]), frameOf([0, 0, 1], [0, 1, 0]), frameOf([1, 0, 0], [0, 1, 0])];
function viewFromCube(cube, basis) {
  const toCube = (v) => add(add(basis[0].map((c) => c * v[0]), basis[1].map((c) => c * v[1])), basis[2].map((c) => c * v[2]));
  return VIEW_SLOTS.map((slot) => {
    const face = cube[key(toCube(slot.n))];
    return { glyph: face.glyph, turn: glyphDirections(slot).findIndex((direction) => same(toCube(direction), face.up)) };
  });
}
const BASES = FRAMES.map((frame) => [frame.r, frame.u, frame.n]);
const validViews = (cube) => new Set(BASES.map((basis) => viewSignature(viewFromCube(cube, basis))));
// Three corner views that pin the cube down: one corner, the opposite corner (so all six faces are seen), and a
// third corner that ties the two together.
function threeViews(cube, rnd) {
  const first = rnd.item(BASES);
  const opposite = [neg(first[0]), neg(first[2]), neg(first[1])];
  const corner = (basis) => basis.map(key).sort().join("|");
  const third = rnd.item(BASES.filter((basis) => corner(basis) !== corner(first) && corner(basis) !== corner(opposite)));
  return rnd.shuffle([first, opposite, third]).map((basis) => viewFromCube(cube, basis));
}
// For a net: which cell ends up opposite each cell once folded.
export function oppositeCells(cells) {
  const frames = foldFrames(cells, FRAMES[0]);
  return frames.map((frame) => frames.findIndex((other) => same(other.n, neg(frame.n))));
}
// Hold the folded cube with face `asked` in front of you, its glyph upright, then turn the cube around sideways
// (a half turn about the vertical axis) to look at the opposite face: returns that face's cell and how many
// clockwise quarter turns its glyph then shows.
export function oppositeAppearance(net, asked) {
  const frames = foldFrames(net.cells, FRAMES[0]);
  const front = frames[asked];
  const cell = frames.findIndex((frame) => same(frame.n, neg(front.n)));
  const up = glyphDirections(front)[net.faces[asked].turn];
  const right = cross(up, front.n);
  const top = glyphDirections(frames[cell])[net.faces[cell].turn];
  // Seen from behind, what was on the right is now on the left.
  return { cell, turn: [up, neg(right), neg(up), right].findIndex((direction) => same(direction, top)) };
}
export function randomShape(random = Math.random) {
  const rnd = tools(random);
  return transformShape(rnd.item(SHAPES), rnd.int(0, 3), rnd.chance(0.5));
}
const viewSignature = (view) => view.map((slot) => slot.glyph + slot.turn).join("");
const oppositeGlyph = (cube, glyph) => cube[key(neg(AXES.find((axis) => cube[key(axis)].glyph === glyph)))].glyph;

function tools(random) {
  const int = (min, max) => Math.floor(random() * (max - min + 1)) + min;
  const item = (items) => items[Math.floor(random() * items.length)];
  const shuffle = (items) => {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) { const other = Math.floor(random() * (index + 1)); [copy[index], copy[other]] = [copy[other], copy[index]]; }
    return copy;
  };
  return { int, item, shuffle, chance: (p) => random() < p };
}

// Ways a wrong answer can be wrong, from the most obvious to the most subtle:
// - "adjacent": faces that are opposite on the real cube end up side by side (no need to look at orientations)
// - "mirror": the right faces, but arranged the other way round
// - "turn": everything in place, one glyph turned
const FLAWS = { easy: ["adjacent"], medium: ["adjacent", "mirror", "mirror"], hard: ["mirror", "turn", "turn"] };

function flawedView(view, cube, flaw, rnd) {
  const copy = view.map((slot) => ({ ...slot }));
  if (flaw === "turn") { const slot = rnd.item(copy); slot.turn = (slot.turn + rnd.int(1, 3)) % 4; return copy; }
  if (flaw === "mirror") { const [a, b] = rnd.shuffle([0, 1, 2]); [copy[a], copy[b]] = [copy[b], copy[a]]; return copy; }
  const [target, other] = rnd.shuffle([0, 1, 2]);
  copy[target] = { glyph: oppositeGlyph(cube, copy[other].glyph), turn: rnd.int(0, 3) };
  return copy;
}
function flawedCube(cube, flaw, rnd) {
  const copy = Object.fromEntries(Object.entries(cube).map(([normal, face]) => [normal, { ...face }]));
  const axis = rnd.item(AXES);
  const face = copy[key(axis)];
  if (flaw === "turn") {
    const directions = glyphDirections(frameOf(axis, face.up));
    face.up = directions[rnd.int(1, 3)];
    return copy;
  }
  // Exchanging glyphs keeps each face's own orientation slot, so only the arrangement changes.
  const partner = flaw === "mirror" ? neg(axis) : rnd.item(AXES.filter((candidate) => dot(candidate, axis) === 0));
  [face.glyph, copy[key(partner)].glyph] = [copy[key(partner)].glyph, face.glyph];
  return copy;
}

function randomNet(cube, shapeIndex, rnd) {
  return { shapeIndex, ...netFromCube(cube, transformShape(SHAPES[shapeIndex], rnd.int(0, 3), rnd.chance(0.5)), rnd.item(FRAMES)) };
}

// mode "fold": which cube does this net make?   mode "refold": which other net makes the same cube?
// mode "unfold": the cube is shown from three corners; which net makes it?
// `random` is injectable for seeded daily challenges.
export function buildPuzzle(mode, level, random = Math.random) {
  const rnd = tools(random);
  const glyphs = rnd.shuffle(GLYPH_NAMES).slice(0, 6);
  const seedShape = transformShape(SHAPES[0], 0, false);
  const cube = cubeFromNet({ cells: seedShape, faces: glyphs.map((glyph) => ({ glyph, turn: rnd.int(0, 3) })) });
  const shapeOrder = rnd.shuffle(SHAPES.map((_, index) => index));
  const net = randomNet(cube, shapeOrder[0], rnd);
  const flaws = rnd.shuffle(FLAWS[level]);
  let options;
  let views = null;

  if (mode === "fold") {
    const valid = validViews(cube);
    const answer = viewFromCube(cube, rnd.item(BASES));
    const wrong = [];
    for (let attempt = 0; wrong.length < 3 && attempt < 200; attempt += 1) {
      const candidate = flawedView(answer, cube, flaws[wrong.length % flaws.length], rnd);
      const signature = viewSignature(candidate);
      if (valid.has(signature) || wrong.some((entry) => viewSignature(entry.view) === signature)) continue;
      wrong.push({ view: candidate });
    }
    options = [{ view: answer, correct: true }, ...wrong];
  } else {
    const signature = cubeSignature(cube);
    views = mode === "unfold" ? threeViews(cube, rnd) : null;
    const wrong = [];
    for (let attempt = 0; wrong.length < 3 && attempt < 200; attempt += 1) {
      const candidate = flawedCube(cube, flaws[wrong.length % flaws.length], rnd);
      const candidateSignature = cubeSignature(candidate);
      if (candidateSignature === signature || wrong.some((entry) => entry.signature === candidateSignature)) continue;
      // A wrong net must contradict at least one of the views shown.
      if (views) { const valid = validViews(candidate); if (views.every((view) => valid.has(viewSignature(view)))) continue; }
      wrong.push({ signature: candidateSignature, net: randomNet(candidate, shapeOrder[wrong.length + 2], rnd) });
    }
    options = [{ net: randomNet(cube, shapeOrder[mode === "unfold" ? 0 : 1], rnd), correct: true }, ...wrong];
  }
  if (options.length < 4) return null;
  const shuffled = rnd.shuffle(options);
  return { mode, level, net, views, options: shuffled, answerIndex: shuffled.findIndex((option) => option.correct) };
}

export function levelForIndex(difficulty, index, total) {
  if (difficulty !== "progressive") return difficulty;
  const progress = total <= 1 ? 1 : index / (total - 1);
  return progress < 0.34 ? "easy" : progress < 0.67 ? "medium" : "hard";
}

// Test hooks.
export const internals = { cubeFromNet, netFromCube, cubeSignature, viewFromCube, BASES, transformShape };
