import { useEffect } from "react";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";

import { SPACE_CADET } from "../theme/spaceCadet";

export function PulsingPrompt({ children, color = SPACE_CADET.white, style }) {
  const intensity = useSharedValue(0.5);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: 0.58 + intensity.value * 0.34 }));

  useEffect(() => {
    intensity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      true
    );
  }, [intensity]);

  return <Animated.Text style={[styles.prompt, { color }, animatedStyle, style]}>{children}</Animated.Text>;
}

const styles = {
  prompt: {
    fontFamily: "Gontserrat-SemiBold",
    fontSize: 12,
    letterSpacing: 1.8,
    textAlign: "center",
  },
};
