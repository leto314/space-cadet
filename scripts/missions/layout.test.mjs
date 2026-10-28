// Mission board (src/missions/layout.js): correctness of the placement of the modules' blocks.
//   npm run test:missions --
// The board is a GRID_COLS x GRID_ROWS grid of half-block cells. These tests use hand-made block sets, so they
// do not depend on the module catalogue.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { BLOCK_GAP, boardMetrics, cellRect, GRID_COLS, GRID_ROWS, planLayout } from "../../src/missions/layout.js";
import { same } from "./helpers.mjs";

// The block catalogue of the board, as documented at the top of layout.js.
const CATALOGUE = [[4, 4], [4, 2], [2, 4], [2, 2], [4, 1], [1, 4], [2, 1], [1, 2], [1, 1]];
const block = (key, h, w, role = "display", extra = {}) => ({ key, h, w, role, ...extra });
const fakeModule = (id, blocks) => ({ id, blocks });
const cellsOf = (modules) => modules.reduce((sum, module) => sum + module.blocks.reduce((area, entry) => area + entry.h * entry.w, 0), 0);

// Every cell a plan uses, as "row,col" strings, checking nothing leaves the grid.
function occupiedCells(plan, label) {
  const cells = [];
  for (const [id, placement] of Object.entries(plan.placements)) {
    assert.ok(placement.row >= 0 && placement.row + placement.h <= plan.rows, `${label}: ${id} leaves the ${plan.rows} rows used`);
    assert.ok(placement.col >= 0 && placement.col + placement.w <= GRID_COLS, `${label}: ${id} leaves the ${GRID_COLS} columns`);
    for (let row = placement.row; row < placement.row + placement.h; row += 1) for (let col = placement.col; col < placement.col + placement.w; col += 1) cells.push(`${row},${col}`);
  }
  return cells;
}

describe("Mission board - placement", () => {
  test("the board is the documented 4 x 8 grid of half-block cells", () => {
    assert.equal(GRID_COLS, 4);
    assert.equal(GRID_ROWS, 8);
  });

  test("every block of the catalogue fits the grid on its own", () => {
    for (const [h, w] of CATALOGUE) {
      assert.ok(h <= GRID_ROWS && w <= GRID_COLS, `a ${h} x ${w} block does not fit the board`);
      const plan = planLayout([fakeModule("solo", [block("only", h, w)])]);
      assert.ok(plan, `a single ${h} x ${w} block could not be placed`);
      assert.equal(occupiedCells(plan, `${h} x ${w}`).length, h * w);
    }
  });

  test("blocks never overlap and never leave the grid", () => {
    const sets = [
      [fakeModule("a", [block("display", 4, 4, "display"), block("stick", 2, 2, "control", { use: "frequent" })]), fakeModule("b", [block("panel", 1, 4, "display"), block("keys", 2, 2, "control")])],
      [fakeModule("a", [block("d", 2, 2)]), fakeModule("b", [block("d", 2, 2)]), fakeModule("c", [block("d", 2, 2)]), fakeModule("d", [block("d", 2, 2)]), fakeModule("e", [block("d", 4, 2)])],
      [fakeModule("a", [block("tall", 4, 1), block("wide", 1, 4, "control")]), fakeModule("b", [block("tall", 4, 1)]), fakeModule("c", [block("tiny", 1, 1, "control", { use: "rare" })])],
      [fakeModule("a", [block("full", 4, 4)]), fakeModule("b", [block("full", 4, 4)])],
    ];
    sets.forEach((modules, index) => {
      const plan = planLayout(modules);
      assert.ok(plan, `set ${index + 1} could not be placed`);
      const cells = occupiedCells(plan, `set ${index + 1}`);
      assert.equal(new Set(cells).size, cells.length, `set ${index + 1}: two blocks overlap`);
      assert.equal(cells.length, cellsOf(modules), `set ${index + 1}: a block is missing from the plan`);
      assert.equal(Object.keys(plan.placements).length, modules.reduce((sum, module) => sum + module.blocks.length, 0), `set ${index + 1}: a block was not placed`);
    });
  });

  test("the same modules always give the same board", () => {
    const modules = [fakeModule("a", [block("d", 2, 4, "display"), block("c", 2, 2, "control")]), fakeModule("b", [block("d", 4, 2, "display"), block("c", 1, 2, "control", { use: "rare" })])];
    const first = planLayout(modules);
    for (let run = 0; run < 3; run += 1) assert.ok(same(first, planLayout(modules)), `run ${run + 2} gives a different board`);
  });

  test("a light mission uses as few rows as possible, and the rows it uses are well filled", () => {
    const light = planLayout([fakeModule("a", [block("d", 2, 2)]), fakeModule("b", [block("c", 2, 2, "control")])]);
    assert.equal(light.rows, 2, `a board of two 1 x 1 widgets takes ${light.rows} rows`);
    const medium = planLayout([fakeModule("a", [block("d", 4, 4)]), fakeModule("b", [block("c", 2, 2, "control")]), fakeModule("c", [block("c", 2, 2, "control")])]);
    assert.ok(medium.rows <= 6, `a 2 x 2 plus two 1 x 1 widgets takes ${medium.rows} rows`);
    assert.ok(medium.rows <= GRID_ROWS);
  });

  test("displays sit above the controls, and the most used controls end up lowest", () => {
    const plan = planLayout([fakeModule("a", [block("display", 2, 4, "display"), block("rare", 1, 2, "control", { use: "rare" }), block("frequent", 2, 2, "control", { use: "frequent" })])]);
    const { placements } = plan;
    assert.ok(placements["a:display"].row < placements["a:frequent"].row, "the display should sit above the controls");
    assert.ok(placements["a:display"].row < placements["a:rare"].row, "the display should sit above every control");
    assert.equal(placements["a:frequent"].row + placements["a:frequent"].h, plan.rows, "the most used control should reach the bottom row");
    assert.equal(placements["a:frequent"].col + placements["a:frequent"].w, GRID_COLS, "the most used control should reach the right edge, where the thumb is");
  });

  test("a block one widget wide never straddles the middle of the board", () => {
    for (const h of [1, 2, 4]) {
      const plan = planLayout([fakeModule("a", [block("d", h, 2, "display")]), fakeModule("b", [block("c", h, 2, "control")])]);
      for (const [id, placement] of Object.entries(plan.placements)) assert.equal(placement.col % 2, 0, `${id} starts at column ${placement.col}`);
    }
  });

  test("a set that cannot fit on one screen is refused, not squeezed in", () => {
    const full = Array.from({ length: 2 }, (_, index) => fakeModule(`m${index}`, [block("full", 4, 4)]));
    assert.equal(cellsOf(full), GRID_COLS * GRID_ROWS, "two 2 x 2 blocks fill the board exactly");
    assert.ok(planLayout(full), "a board filled exactly should still be placed");
    assert.equal(planLayout([...full, fakeModule("x", [block("d", 1, 1)])]), null, "one cell too many should be refused");
  });
});

describe("Mission board - geometry", () => {
  test("the cell size comes from the full grid, so a block keeps its size whatever the mission", () => {
    const tall = boardMetrics(390, 700, GRID_ROWS);
    const short = boardMetrics(390, 700, 4);
    assert.equal(tall.cell, short.cell, "a shorter board should not grow its cells");
    assert.ok(short.boardHeight < tall.boardHeight, "a shorter board should be shorter");
    assert.equal(Math.round(short.offsetY + short.boardHeight), 700, "a shorter board sits at the bottom of the screen");
  });

  test("the board fits the screen it is measured for", () => {
    for (const [width, height] of [[320, 520], [390, 700], [430, 900]]) {
      for (const rows of [2, 4, 6, 8]) {
        const metrics = boardMetrics(width, height, rows);
        assert.ok(metrics.cell > 0, `${width}x${height}: cell size ${metrics.cell}`);
        assert.ok(metrics.boardWidth <= width + 0.5, `${width}x${height}: the board is wider than the screen`);
        assert.ok(metrics.boardHeight <= height + 0.5, `${width}x${height}: the board is taller than the screen`);
        assert.ok(metrics.offsetX >= 0 && metrics.offsetY >= 0, `${width}x${height}: the board starts off screen`);
      }
    }
  });

  test("two blocks side by side are a gap apart, and a plan's rectangles never overlap in pixels", () => {
    const modules = [fakeModule("a", [block("d", 2, 2, "display"), block("c", 2, 2, "control")]), fakeModule("b", [block("d", 2, 2, "display"), block("c", 2, 2, "control")])];
    const plan = planLayout(modules);
    const { cell } = boardMetrics(390, 700, plan.rows);
    const rects = Object.values(plan.placements).map((placement) => cellRect(placement, cell));
    rects.forEach((rect, index) => rects.slice(index + 1).forEach((other) => {
      const overlap = rect.x < other.x + other.width && other.x < rect.x + rect.width && rect.y < other.y + other.height && other.y < rect.y + rect.height;
      assert.ok(!overlap, "two rectangles overlap on the board");
    }));
    const single = cellRect({ row: 0, col: 0, h: 1, w: 1 }, cell);
    const double = cellRect({ row: 0, col: 0, h: 2, w: 2 }, cell);
    assert.equal(double.width, single.width * 2 + BLOCK_GAP, "a 1 x 1 widget is two cells plus the gap");
  });
});
