// The catalogue of mission module specs, readable without React: what each module asks of the player (its
// competences, task type, voice use, load and blocks) and the briefing texts. This is what the generator budgets
// against. The screens are registered separately, in index.js.
//
// Every spec declares:
// - competence / secondary: which of the six categories it trains (primary drives its colour)
// - task: "continuous" (needs constant control), "event" (react when something happens), "opportunistic" (do it
//   whenever there is a spare moment; more is better)
// - voice: whether it speaks instructions (only one talking module can run at a time)
// - load: rough attention cost, to be tuned by playtesting
// - family: variants of one system share a family and never fly together
// - blocks: its display and control blocks, in half-block cells ({ h, w }); role "display" goes top-left,
//   anything else is a control and goes bottom-right

import { airwaysSpec } from "./airways/logic.js";
import { altitudeSpec } from "./altitude/logic.js";
import { anomalyLiteSpec, anomalySpec } from "./anomaly/logic.js";
import { codesSpec, codesVoiceSpec } from "./codes/logic.js";
import { cubeSpec } from "./cube/logic.js";
import { estimationSpec } from "./estimation/logic.js";
import { miniMemorySpec, miniScanSpec } from "./grids/logic.js";
import { headingSpec } from "./heading/logic.js";
import { logicGatesSpec } from "./logic-gates/logic.js";
import { miniLandingSpec, miniLandingSplitSpec, miniSwitchboardSpec } from "./logic-puzzles/logic.js";
import { mathCheckSpec } from "./math-check/logic.js";
import { radioCallsignSpec, radioSpec } from "./radio/logic.js";
import { runningTotalSpec } from "./running-total/logic.js";
import { oppositeFaceSpec, rotationMatchSpec } from "./spatial/logic.js";
import { systemLightsSpec } from "./system-lights/logic.js";
import { tanksSpec } from "./tanks/logic.js";
import { trackingMiniSpec, trackingSpec } from "./tracking/logic.js";

const ALL = [
  altitudeSpec, mathCheckSpec, systemLightsSpec, radioSpec, radioCallsignSpec, headingSpec, logicGatesSpec, codesSpec, codesVoiceSpec,
  anomalySpec, anomalyLiteSpec, tanksSpec, trackingSpec, trackingMiniSpec, cubeSpec, runningTotalSpec, miniScanSpec, miniSwitchboardSpec,
  miniLandingSpec, miniLandingSplitSpec, estimationSpec, airwaysSpec, rotationMatchSpec, oppositeFaceSpec, miniMemorySpec,
];

export const SPECS = Object.fromEntries(ALL.map((spec) => [spec.id, spec]));
export const TASK_LABELS = { continuous: "CONTINUOUS CONTROL", event: "RESPOND TO EVENTS", opportunistic: "WHEN YOU HAVE TIME" };
