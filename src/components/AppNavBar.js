import { StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Easing, Extrapolation, interpolate, runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { BlurView } from "expo-blur";

import { HomeIcon, RadarIcon, UserIcon } from "./NavIcons";
import { SPACE_CADET } from "../theme/spaceCadet";
import { triggerSelectionHaptic } from "../utils/haptics";

// Native Liquid Glass only exists on iOS 26+ (and needs the native module); everywhere else we fall back to a blur.
let GlassView = null;
try {
  const glass = require("expo-glass-effect");
  if (glass.isLiquidGlassAvailable() && glass.isGlassEffectAPIAvailable()) GlassView = glass.GlassView;
} catch {}

const TABS = [{ key: "stats", label: "Statistics", Icon: RadarIcon }, { key: "home", label: "Home", Icon: HomeIcon }, { key: "profile", label: "Profile", Icon: UserIcon }];
const SIDE_MARGIN = 20;
const PILL_HEIGHT = 62;
const PAD = 3;
const LENS_HEIGHT = PILL_HEIGHT - PAD * 2;
const LAST_TAB = TABS.length - 1;

function lensPosition(progress, isDragging, dragPos) {
  "worklet";
  return isDragging.value ? dragPos.value : progress.value;
}

function Rim({ radius, strength = 1 }) {
  const white = (alpha) => `rgba(255,255,255,${(alpha * strength).toFixed(3)})`;
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, {
    borderRadius: radius,
    boxShadow: [
      { offsetX: 0, offsetY: 1, blurRadius: 2, color: white(0.14), inset: true },
      { offsetX: 0, offsetY: 3, blurRadius: 12, color: white(0.12), inset: true },
      { offsetX: 0, offsetY: -2, blurRadius: 10, color: white(0.05), inset: true },
    ],
  }]} />;
}

function BarSurface() {
  const radius = PILL_HEIGHT / 2;
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden" }]}>
    <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
    <View style={[StyleSheet.absoluteFill, styles.barShade]} />
    {GlassView ? <GlassView glassEffectStyle="clear" colorScheme="dark" tintColor="rgba(0,0,0,0.1)" style={[StyleSheet.absoluteFill, { borderRadius: radius }]} /> : null}
    <View style={[StyleSheet.absoluteFill, styles.barShadeTop]} />
  </View>;
}

function TabButton({ index, label, Icon, progress, isDragging, dragPos, onPress }) {
  const iconStyle = useAnimatedStyle(() => ({ opacity: interpolate(Math.abs(lensPosition(progress, isDragging, dragPos) - index), [0, 1], [1, 0.45], Extrapolation.CLAMP) }));
  return <View accessible accessibilityRole="tab" accessibilityLabel={label} onAccessibilityTap={onPress} style={styles.button}>
    <Animated.View style={iconStyle}><Icon color={SPACE_CADET.white} /></Animated.View>
  </View>;
}

// `progress` is the pager position in page units (0 = first tab). The lens follows it, or the finger while the bar is being dragged.
export function AppNavBar({ progress, onSelect }) {
  const { width } = useWindowDimensions();
  const pillWidth = width - SIDE_MARGIN * 2;
  const tabWidth = (pillWidth - PAD * 2) / TABS.length;
  const isDragging = useSharedValue(0);
  const dragPos = useSharedValue(1);
  const releaseTarget = useSharedValue(-1);
  const lastTab = useSharedValue(1);

  useAnimatedReaction(() => progress.value, (value) => {
    if (releaseTarget.value >= 0 && Math.abs(value - releaseTarget.value) < 0.02) {
      isDragging.value = 0;
      releaseTarget.value = -1;
    }
  });

  const pan = Gesture.Pan().minDistance(4)
    .onStart((event) => {
      isDragging.value = 1;
      releaseTarget.value = -1;
      dragPos.value = Math.max(0, Math.min(LAST_TAB, (event.x - PAD) / tabWidth - 0.5));
      lastTab.value = Math.round(dragPos.value);
    })
    .onUpdate((event) => {
      dragPos.value = Math.max(0, Math.min(LAST_TAB, (event.x - PAD) / tabWidth - 0.5));
      const tab = Math.round(dragPos.value);
      if (tab !== lastTab.value) {
        lastTab.value = tab;
        runOnJS(triggerSelectionHaptic)();
      }
    })
    .onEnd(() => {
      const target = Math.round(dragPos.value);
      releaseTarget.value = target;
      dragPos.value = withTiming(target, { duration: 220, easing: Easing.out(Easing.cubic) }, () => {
        if (Math.abs(progress.value - target) < 0.02) {
          isDragging.value = 0;
          releaseTarget.value = -1;
        }
      });
      runOnJS(onSelect)(target);
    });

  const tap = Gesture.Tap().maxDistance(10).onEnd((event, success) => {
    if (!success) return;
    runOnJS(onSelect)(Math.max(0, Math.min(LAST_TAB, Math.floor((event.x - PAD) / tabWidth))));
  });
  const gesture = Gesture.Race(pan, tap);

  const lensStyle = useAnimatedStyle(() => ({ transform: [{ translateX: lensPosition(progress, isDragging, dragPos) * tabWidth }] }));

  return <View pointerEvents="box-none" style={styles.shell}>
    <GestureDetector gesture={gesture}>
      <View style={styles.pill}>
        <BarSurface />
        <Rim radius={PILL_HEIGHT / 2} strength={0.5} />
        <Animated.View pointerEvents="none" style={[styles.lens, { width: tabWidth }, lensStyle]}><Rim radius={LENS_HEIGHT / 2} strength={0.5} /></Animated.View>
        <View style={styles.row}>
          {TABS.map(({ key, label, Icon }, index) => <TabButton key={key} index={index} label={label} Icon={Icon} progress={progress} isDragging={isDragging} dragPos={dragPos} onPress={() => onSelect(index)} />)}
        </View>
      </View>
    </GestureDetector>
  </View>;
}

const styles = StyleSheet.create({
  shell: { position: "absolute", left: SIDE_MARGIN, right: SIDE_MARGIN, bottom: 28 },
  pill: { height: PILL_HEIGHT, borderRadius: PILL_HEIGHT / 2 },
  barShade: { backgroundColor: "rgba(0,0,0,0.64)" },
  barShadeTop: { backgroundColor: "rgba(0,0,0,0.6)" },
  row: { flex: 1, flexDirection: "row", alignItems: "center", padding: PAD },
  lens: { position: "absolute", top: PAD, left: PAD, height: LENS_HEIGHT, borderRadius: LENS_HEIGHT / 2, backgroundColor: "rgba(255,255,255,0.03)" },
  button: { flex: 1, height: LENS_HEIGHT, borderRadius: LENS_HEIGHT / 2, alignItems: "center", justifyContent: "center" },
});
