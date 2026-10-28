// The mission's score: how the modules' performances become the 0–1000 of the debrief (STATS.md §6). Pure
// JavaScript (no React), so a flight can be scored and checked in plain Node.
//
// Each module receives a share of the 1000 points in proportion to its load (a 4-load system weighs twice a
// 2-load one), and earns that share times its performance (0–1). A module left at 0 earns nothing; everything
// perfect earns 1000.

import { SPECS } from "./modules/specs.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// `results`: [{ id, performance, detail }] for every module flown. Returns the score and each module's line.
export function missionScore(results) {
  const loads = results.map((result) => SPECS[result.id]?.load ?? 1);
  const total = loads.reduce((sum, load) => sum + load, 0) || 1;
  const modules = results.map((result, index) => {
    const share = loads[index] / total;
    const performance = clamp(Number(result.performance) || 0, 0, 1);
    return { id: result.id, competence: SPECS[result.id]?.competence ?? null, share, performance, points: Math.round(share * 1000 * performance), detail: result.detail ?? "" };
  });
  return { score: clamp(modules.reduce((sum, module) => sum + module.points, 0), 0, 1000), modules };
}
