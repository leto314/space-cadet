import { airwaysModule } from "./AirwaysModule";
import { altitudeModule } from "./AltitudeModule";
import { anomalyLiteModule, anomalyModule } from "./AnomalyModule";
import { codesModule, codesVoiceModule } from "./CodesModule";
import { cubeModule } from "./CubeModule";
import { estimationModule } from "./EstimationModule";
import { miniMemoryModule, miniScanModule } from "./GridModules";
import { headingModule } from "./HeadingModule";
import { logicGatesModule } from "./LogicGatesModule";
import { miniLandingModule, miniLandingSplitModule, miniSwitchboardModule } from "./LogicPuzzleModules";
import { mathCheckModule } from "./MathCheckModule";
import { radioCallsignModule, radioModule } from "./RadioModule";
import { runningTotalModule } from "./RunningTotalModule";
import { oppositeFaceModule, rotationMatchModule } from "./SpatialModules";
import { systemLightsModule } from "./SystemLightsModule";
import { tanksModule } from "./TanksModule";
import { trackingMiniModule, trackingModule } from "./TrackingModule";

// Every module declares what it asks of the player, which is what the mission generator will budget against:
// - competence / secondary: which of the six categories it trains (primary drives its colour)
// - task: "continuous" (needs constant control), "event" (react when something happens), "opportunistic" (do it
//   whenever there is a spare moment; more is better)
// - voice: whether it speaks instructions (only one talking module can run at a time)
// - load: rough attention cost, to be tuned by playtesting
// - blocks: its display and control blocks, in half-block cells ({ h, w }); role "display" goes top-left,
//   anything else is a control and goes bottom-right
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

export const TASK_LABELS = { continuous: "CONTINUOUS CONTROL", event: "RESPOND TO EVENTS", opportunistic: "WHEN YOU HAVE TIME" };
