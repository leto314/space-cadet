// Mission board: a 4 × 8 grid of half-block cells. Block sizes are written { h, w } in cells (plus optional
// placement hints: `refresh` for displays, `use` for controls); the catalogue:
//   2×2 → h4 w4   2×1 → h4 w2   1×2 → h2 w4   1×1 → h2 w2
//   2×½ → h4 w1   ½×2 → h1 w4   1×½ → h2 w1   ½×1 → h1 w2   ½×½ → h1 w1
export const GRID_COLS = 4;
export const GRID_ROWS = 8;
export const BLOCK_GAP = 14;
export const BLOCK_RADIUS = 24;

// Hierarchical placement:
// - displays go first from the top-left; displays that change rarely (refresh "slow") take the top rows, then
//   larger before smaller and tall before wide, so a 2×2 or a pair of vertical blocks sits high on the screen;
// - controls then fill from the bottom-right, where the thumbs are: the most used (use "frequent") are placed
//   first and end up lowest and furthest right, rarely touched ones (use "rare") land above them.
// The board uses as few rows as possible: each height is tried from the smallest up, so a light mission is a
// compact board rather than a full-height grid with holes. A module's display and control may end up apart;
// they are tied together by the module's colour.
const REFRESH_RANK = { slow: 0, normal: 1, fast: 2 };
const USE_RANK = { frequent: 0, normal: 1, rare: 2 };

export function planLayout(modules) {
  const blocks = modules.flatMap((module) => module.blocks.map((block) => ({ ...block, moduleId: module.id, id: `${module.id}:${block.key}` })));
  const displays = blocks.filter((block) => block.role === "display")
    .sort((a, b) => REFRESH_RANK[a.refresh ?? "normal"] - REFRESH_RANK[b.refresh ?? "normal"] || b.h * b.w - a.h * a.w || b.h - a.h);
  const controls = blocks.filter((block) => block.role !== "display")
    .sort((a, b) => USE_RANK[a.use ?? "normal"] - USE_RANK[b.use ?? "normal"] || b.h * b.w - a.h * a.w || b.w - a.w);
  const ordered = [...displays, ...controls];
  const minRows = Math.max(...blocks.map((block) => block.h), Math.ceil(blocks.reduce((sum, block) => sum + block.h * block.w, 0) / GRID_COLS));
  for (let rows = minRows; rows <= GRID_ROWS; rows += 1) {
    const placements = placeAll(ordered, rows);
    if (placements) return { placements, rows };
  }
  return null;
}

// A block one widget wide (2 cells) sits in the left or the right half, never straddling the middle.
function columnAllowed(block, col) {
  return block.w !== 2 || col % 2 === 0;
}

// The search gives up after a fixed number of tries (and the layout counts as not fitting): an awkward set of
// blocks could otherwise take exponentially long to rule out.
const SEARCH_BUDGET = 3000;

function placeAll(ordered, rows) {
  let tries = 0;
  const occupied = Array.from({ length: rows }, () => Array(GRID_COLS).fill(false));
  const placements = {};
  const fits = (block, row, col) => {
    for (let r = row; r < row + block.h; r += 1) for (let c = col; c < col + block.w; c += 1) if (occupied[r][c]) return false;
    return true;
  };
  const mark = (block, row, col, value) => {
    for (let r = row; r < row + block.h; r += 1) for (let c = col; c < col + block.w; c += 1) occupied[r][c] = value;
  };
  const candidates = (block) => {
    const spots = [];
    for (let row = 0; row <= rows - block.h; row += 1) for (let col = 0; col <= GRID_COLS - block.w; col += 1) if (columnAllowed(block, col)) spots.push({ row, col });
    return block.role === "display" ? spots : spots.reverse();
  };
  const place = (index) => {
    if (index === ordered.length) return true;
    const block = ordered[index];
    for (const { row, col } of candidates(block)) {
      if (!fits(block, row, col)) continue;
      tries += 1;
      if (tries > SEARCH_BUDGET) return false;
      mark(block, row, col, true);
      placements[block.id] = { row, col, h: block.h, w: block.w };
      if (place(index + 1)) return true;
      mark(block, row, col, false);
      delete placements[block.id];
    }
    return false;
  };
  return place(0) ? placements : null;
}

// Cell size always comes from the full 8-row grid, so blocks keep the same size from one mission to the next;
// a board with fewer rows is simply shorter and sits at the bottom of the screen, where the thumbs are.
export function boardMetrics(width, height, rows) {
  const cell = Math.floor(Math.min((width - BLOCK_GAP * (GRID_COLS - 1)) / GRID_COLS, (height - BLOCK_GAP * (GRID_ROWS - 1)) / GRID_ROWS));
  const boardWidth = cell * GRID_COLS + BLOCK_GAP * (GRID_COLS - 1);
  const boardHeight = cell * rows + BLOCK_GAP * (rows - 1);
  return { cell, boardWidth, boardHeight, offsetX: (width - boardWidth) / 2, offsetY: height - boardHeight };
}

export function cellRect(placement, cell) {
  return {
    x: placement.col * (cell + BLOCK_GAP),
    y: placement.row * (cell + BLOCK_GAP),
    width: placement.w * cell + (placement.w - 1) * BLOCK_GAP,
    height: placement.h * cell + (placement.h - 1) * BLOCK_GAP,
  };
}
