import { useState } from "react";
import { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

const entranceConfig = { duration: 336, easing: Easing.out(Easing.cubic) };
const returnConfig = { duration: 280, easing: Easing.bezier(0.22, 0.61, 0.36, 1) };

export function useMissionTransition({ onPrepareReturn, onReturnComplete }) {
  const [isReturning, setIsReturning] = useState(false);
  const missionTranslateX = useSharedValue(0);
  const missionOpacity = useSharedValue(0);
  const preflightTranslateX = useSharedValue(0);
  const preflightOpacity = useSharedValue(1);

  const missionStyle = useAnimatedStyle(() => ({
    opacity: missionOpacity.value,
    transform: [{ translateX: missionTranslateX.value }],
  }));
  const preflightStyle = useAnimatedStyle(() => ({
    opacity: preflightOpacity.value,
    transform: [{ translateX: preflightTranslateX.value }],
  }));

  function completeReturn() {
    missionTranslateX.value = 0;
    missionOpacity.value = 0;
    preflightOpacity.value = 1;
    onReturnComplete?.();
    setIsReturning(false);
  }

  function startMission(start) {
    missionTranslateX.value = 0;
    missionOpacity.value = 0;
    preflightOpacity.value = 1;
    start?.();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        missionOpacity.value = withTiming(1, entranceConfig);
      });
    });
  }

  function returnToPreflight() {
    if (isReturning) {
      return;
    }

    onPrepareReturn?.();
    preflightTranslateX.value = -18;
    preflightOpacity.value = 0.72;
    missionOpacity.value = 1;
    setIsReturning(true);

    requestAnimationFrame(() => {
      preflightTranslateX.value = withTiming(0, returnConfig);
      preflightOpacity.value = withTiming(1, returnConfig);
      missionOpacity.value = withTiming(0.94, returnConfig);
      missionTranslateX.value = withTiming(440, returnConfig, (finished) => {
        if (finished) {
          runOnJS(completeReturn)();
        }
      });
    });
  }

  return { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight };
}
