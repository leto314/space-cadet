import { airwaysModule } from "./airways/AirwaysModule";
import { altitudeModule } from "./altitude/AltitudeModule";
import { anomalyLiteModule, anomalyModule } from "./anomaly/AnomalyModule";
import { codesModule, codesVoiceModule } from "./codes/CodesModule";
import { cubeModule } from "./cube/CubeModule";
import { estimationModule } from "./estimation/EstimationModule";
import { miniMemoryModule, miniScanModule } from "./grids/GridModules";
import { headingModule } from "./heading/HeadingModule";
import { logicGatesModule } from "./logic-gates/LogicGatesModule";
import { miniLandingModule, miniLandingSplitModule, miniSwitchboardModule } from "./logic-puzzles/LogicPuzzleModules";
import { mathCheckModule } from "./math-check/MathCheckModule";
import { radioCallsignModule, radioModule } from "./radio/RadioModule";
import { runningTotalModule } from "./running-total/RunningTotalModule";
import { oppositeFaceModule, rotationMatchModule } from "./spatial/SpatialModules";
import { systemLightsModule } from "./system-lights/SystemLightsModule";
import { tanksModule } from "./tanks/TanksModule";
import { trackingMiniModule, trackingModule } from "./tracking/TrackingModule";

export { TASK_LABELS } from "./specs";

// Every module on the board: its spec (see specs.js, the pure catalogue the generator reads) plus the React
// component that shows it. Each module lives in its own folder, split in logic.js (spec, content from the seed,
// scoring) and <Name>Module.js (the screen).
export const MODULES = {
  [altitudeModule.id]: altitudeModule,
  [mathCheckModule.id]: mathCheckModule,
  [systemLightsModule.id]: systemLightsModule,
  [radioModule.id]: radioModule,
  [radioCallsignModule.id]: radioCallsignModule,
  [headingModule.id]: headingModule,
  [logicGatesModule.id]: logicGatesModule,
  [codesModule.id]: codesModule,
  [codesVoiceModule.id]: codesVoiceModule,
  [anomalyModule.id]: anomalyModule,
  [anomalyLiteModule.id]: anomalyLiteModule,
  [tanksModule.id]: tanksModule,
  [trackingModule.id]: trackingModule,
  [trackingMiniModule.id]: trackingMiniModule,
  [cubeModule.id]: cubeModule,
  [runningTotalModule.id]: runningTotalModule,
  [miniScanModule.id]: miniScanModule,
  [miniSwitchboardModule.id]: miniSwitchboardModule,
  [miniLandingModule.id]: miniLandingModule,
  [miniLandingSplitModule.id]: miniLandingSplitModule,
  [estimationModule.id]: estimationModule,
  [airwaysModule.id]: airwaysModule,
  [rotationMatchModule.id]: rotationMatchModule,
  [oppositeFaceModule.id]: oppositeFaceModule,
  [miniMemoryModule.id]: miniMemoryModule,
};
