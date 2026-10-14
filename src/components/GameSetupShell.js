import { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";

import { CATEGORY_CONFIG, GAME_SETUP_META, SPACE_CADET } from "../theme/spaceCadet";
import { GlowChart } from "./GlowChart";
import { triggerSelectionHaptic } from "../utils/haptics";

export function PressScaleButton({ children, onPress, variant = "primary", style }) {
  function handlePress() {
    void triggerSelectionHaptic();
    onPress?.();
  }

  return (
    <Pressable onPress={handlePress} style={({ pressed }) => [styles.button, styles[variant], style, pressed && styles.pressed]}>
      <Text style={[styles.buttonText, variant === "primary" && styles.primaryButtonText]}>{children}</Text>
    </Pressable>
  );
}

export function SettingCard({ label, value, hint, children }) {
  return (
    <View style={styles.settingCard}>
      <View style={styles.settingTopRow}>
        <Text style={styles.settingLabel}>{label}</Text>
        {value ? <Text style={styles.settingValue}>{value}</Text> : null}
      </View>
      {children}
      {hint ? <Text style={styles.settingHint}>{hint}</Text> : null}
    </View>
  );
}

export function ChoiceRow({ children }) {
  return <View style={styles.choiceRow}>{children}</View>;
}

export function ChoiceButton({ label, selected, onPress, accessibilityLabel, accent, compact = false }) {
  function handlePress() {
    void triggerSelectionHaptic();
    onPress?.();
  }

  return (
    <Pressable
      onPress={handlePress}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.choiceButton, selected && styles.choiceButtonSelected, selected && accent ? { backgroundColor: `${accent}1F`, borderColor: `${accent}88` } : null, pressed && styles.pressed]}
    >
      <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.choiceText, compact && styles.choiceTextCompact, selected && styles.choiceTextSelected, selected && accent ? { color: accent } : null]}>{label}</Text>
    </Pressable>
  );
}

export function PickerSetting({ label, hint, options, value, onChange }) {
  return (
    <SettingCard label={label} hint={hint}>
      <TapePicker options={options} value={value} onChange={onChange} />
    </SettingCard>
  );
}

export function ToggleSetting({ label, value, onChange, accent }) {
  return (
    <SettingCard label={label}>
      <ChoiceRow>
        <ChoiceButton label="OFF" selected={!value} onPress={() => onChange(false)} />
        <ChoiceButton label="ON" selected={value} onPress={() => onChange(true)} accent={accent} />
      </ChoiceRow>
    </SettingCard>
  );
}

const TAPE_ITEM_WIDTH = 98;

function TapePickerItem({ index, label, scrollX, onPress }) {
  const animatedStyle = useAnimatedStyle(() => {
    const position = index * TAPE_ITEM_WIDTH;
    const distance = scrollX.value - position;
    const opacity = interpolate(distance, [-TAPE_ITEM_WIDTH * 1.6, -TAPE_ITEM_WIDTH * 0.52, 0, TAPE_ITEM_WIDTH * 0.52, TAPE_ITEM_WIDTH * 1.6], [0.18, 0.42, 1, 0.42, 0.18], Extrapolation.CLAMP);
    const scale = interpolate(distance, [-TAPE_ITEM_WIDTH, 0, TAPE_ITEM_WIDTH], [0.74, 1.42, 0.74], Extrapolation.CLAMP);
    return { opacity, transform: [{ scale }] };
  });

  return (
    <Pressable onPress={onPress} style={styles.tapeItem} hitSlop={4}>
      <Animated.Text numberOfLines={1} adjustsFontSizeToFit style={[styles.tapeText, (label === "RANDOM" || label.length > 7) && styles.tapeTextWord, animatedStyle]}>{label}</Animated.Text>
    </Pressable>
  );
}

export function TapePicker({ options, value, onChange }) {
  const scrollRef = useRef(null);
  const [width, setWidth] = useState(0);
  const scrollX = useSharedValue(0);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const lastHapticIndex = useSharedValue(selectedIndex);
  const sidePadding = Math.max(0, (width - TAPE_ITEM_WIDTH) / 2);

  function alignInitial(nextWidth) {
    setWidth(nextWidth);
    const initialOffset = selectedIndex * TAPE_ITEM_WIDTH;
    scrollX.value = initialOffset;
    requestAnimationFrame(() => requestAnimationFrame(() => scrollRef.current?.scrollTo({ x: initialOffset, animated: false })));
  }

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      const offset = event.contentOffset.x;
      scrollX.value = offset;
      const activeIndex = Math.max(0, Math.min(options.length - 1, Math.round(offset / TAPE_ITEM_WIDTH)));
      if (activeIndex !== lastHapticIndex.value) {
        lastHapticIndex.value = activeIndex;
        runOnJS(triggerSelectionHaptic)();
      }
    },
  });

  function selectIndex(nextIndex) {
    const clampedIndex = Math.max(0, Math.min(options.length - 1, nextIndex));

    if (clampedIndex === selectedIndex) {
      return;
    }

    onChange(options[clampedIndex].value);
    scrollRef.current?.scrollTo({ x: clampedIndex * TAPE_ITEM_WIDTH, animated: true });
  }

  return (
    <View style={styles.tapeFrame} onLayout={(event) => { if (!width) alignInitial(event.nativeEvent.layout.width); }}>
      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToOffsets={options.map((_, index) => index * TAPE_ITEM_WIDTH)}
        snapToAlignment="center"
        disableIntervalMomentum
        contentContainerStyle={{ paddingHorizontal: sidePadding }}
        scrollEventThrottle={16}
        onScroll={onScroll}
        onMomentumScrollEnd={(event) => {
          const nextIndex = Math.max(0, Math.min(options.length - 1, Math.round(event.nativeEvent.contentOffset.x / TAPE_ITEM_WIDTH)));
          const snappedOffset = nextIndex * TAPE_ITEM_WIDTH;
          scrollX.value = snappedOffset;
          scrollRef.current?.scrollTo({ x: snappedOffset, animated: false });
          onChange(options[nextIndex].value);
        }}
      >
        {options.map((option, index) => <TapePickerItem key={`${String(option.value)}-${index}`} index={index} label={option.label} scrollX={scrollX} onPress={() => selectIndex(index)} />)}
      </Animated.ScrollView>
    </View>
  );
}

// The progress curve (a glowing shader line, like the statistics radar). With `history` (scores from 0 to 1000,
// oldest first) it shows the real results; without it (games that record nothing yet), a decorative curve.
const SAMPLE_CURVE = [0.14, 0.19, 0.27, 0.24, 0.36, 0.33, 0.45, 0.52, 0.47, 0.62, 0.74, 0.86];

function PerformanceChart({ accent, history, caption }) {
  const real = Array.isArray(history);
  const values = real ? history.map((score) => score / 1000) : SAMPLE_CURVE;
  return (
    <View style={styles.performanceCard}>
      <View style={styles.performanceHeader}>
        <View>
          <Text style={styles.performanceKicker}>YOUR PERFORMANCE</Text>
          <Text style={styles.performanceCaption}>{caption ?? (real && history.length ? `Last ${history.length} ${history.length === 1 ? "result" : "results"}` : "Complete a session to build your history.")}</Text>
        </View>
        {real && history.length ? <Text style={[styles.performanceLatest, { color: accent }]}>{Math.round(history.at(-1))}</Text> : null}
      </View>
      {values.length ? <GlowChart values={values} color={accent} background={SPACE_CADET.surface1} height={76} /> : <View style={styles.performanceEmpty} />}
    </View>
  );
}

function InfoIcon() {
  return <View style={styles.infoGlyph}><Text style={styles.infoGlyphText}>i</Text></View>;
}

function MissionRules({ rules, accent }) {
  const difficultyPattern = /(Easy|Medium|Hard):\s*([\s\S]*?)(?=\s*(?:Easy|Medium|Hard):|$)/g;
  const firstDifficulty = rules.search(/(?:Easy|Medium|Hard):/);
  const overview = firstDifficulty === -1 ? rules : rules.slice(0, firstDifficulty).trim();
  const levels = [...rules.matchAll(difficultyPattern)];
  const sentenceCase = (value) => {
    const cleaned = value.replace(/\s+/g, " ").trim();
    return cleaned ? `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}` : cleaned;
  };

  return (
    <>
      {overview ? <Text style={styles.rulesText}>{overview}</Text> : null}
      {levels.map(([, label, description]) => (
        <View key={label} style={styles.difficultyRule}>
          <Text style={[styles.difficultyRuleLabel, { color: accent }]}>{label.toUpperCase()}</Text>
          <Text style={styles.difficultyRuleText}>{sentenceCase(description)}</Text>
        </View>
      ))}
    </>
  );
}

export function GameSetupShell({ title, categoryKey, category, accent, onExit, rules, children, onStart, startLabel = "Start session", history, historyCaption, settingsLabel = "SESSION SETTINGS" }) {
  const gameMeta = GAME_SETUP_META[title];
  const categoryConfig = CATEGORY_CONFIG[categoryKey ?? gameMeta?.categoryKey];
  const displayTitle = gameMeta?.title ?? title;
  const resolvedCategory = categoryConfig?.label ?? category;
  const resolvedAccent = categoryConfig?.color ?? accent ?? SPACE_CADET.white;
  const [rulesVisible, setRulesVisible] = useState(false);
  const sheetOffset = useSharedValue(0);
  const backdropOpacity = useSharedValue(0);
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetOffset.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

  function closeRules() {
    backdropOpacity.value = withTiming(0, { duration: 260 });
    sheetOffset.value = withTiming(520, { duration: 280 }, (finished) => {
      if (finished) runOnJS(setRulesVisible)(false);
    });
  }

  function openRules() {
    sheetOffset.value = 520;
    backdropOpacity.value = 0;
    setRulesVisible(true);
    requestAnimationFrame(() => {
      backdropOpacity.value = withTiming(1, { duration: 240 });
      sheetOffset.value = withTiming(0, { duration: 330 });
    });
  }

  const sheetGesture = Gesture.Pan()
    .activeOffsetY(8)
    .onUpdate((event) => { sheetOffset.value = Math.max(0, event.translationY); })
    .onEnd((event) => {
      if (event.translationY > 92 || event.velocityY > 720) {
        backdropOpacity.value = withTiming(0, { duration: 260 });
        sheetOffset.value = withTiming(520, { duration: 280 }, (finished) => {
          if (finished) runOnJS(setRulesVisible)(false);
        });
      } else sheetOffset.value = withSpring(0, { damping: 22, stiffness: 240 });
    });

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={onExit} style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable>
          <View style={styles.titleWrap}><Text style={[styles.category, { color: resolvedAccent }]}>{resolvedCategory}</Text><Text style={styles.title}>{displayTitle}</Text></View>
          <Pressable onPress={openRules} style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]} accessibilityLabel={`Instructions for ${displayTitle}`}><InfoIcon /></Pressable>
        </View>

        <PerformanceChart accent={resolvedAccent} history={history} caption={historyCaption} />
        <Text style={styles.settingsKicker}>{settingsLabel}</Text>
        <View style={styles.settings}>{children}</View>
      </ScrollView>
      <View style={styles.fixedFooter}><PressScaleButton onPress={onStart}>{startLabel}</PressScaleButton></View>

      <Modal visible={rulesVisible} transparent animationType="none" onRequestClose={closeRules}>
        <View style={styles.sheetBackdrop}>
          <Animated.View pointerEvents="none" style={[styles.backdropDim, backdropStyle]} />
          <Pressable style={StyleSheet.absoluteFill} onPress={closeRules} accessibilityLabel="Close instructions" />
          <GestureDetector gesture={sheetGesture}>
            <Animated.View style={[styles.rulesSheet, sheetStyle]}>
              <View style={styles.sheetHandle} />
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.rulesContent}>
                <Text style={styles.sheetTitle}>Mission briefing</Text>
                <Text style={[styles.sheetGameTitle, { color: resolvedAccent }]}>{displayTitle}</Text>
                <MissionRules rules={rules} accent={resolvedAccent} />
              </ScrollView>
            </Animated.View>
          </GestureDetector>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SPACE_CADET.black }, content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 118 },
  header: { minHeight: 60, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }, headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, backArrow: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 32, lineHeight: 36 }, titleWrap: { flex: 1, alignItems: "center" }, category: { fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.8, textTransform: "uppercase", marginBottom: 3 }, title: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 29, lineHeight: 35 }, infoGlyph: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: SPACE_CADET.textSecondary, alignItems: "center", justifyContent: "center" }, infoGlyphText: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", fontSize: 12, lineHeight: 15 },
  performanceCard: { height: 132, padding: 15, borderRadius: 18, backgroundColor: SPACE_CADET.surface1, overflow: "hidden" }, performanceHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 2 }, performanceKicker: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 10, letterSpacing: 1.6 }, performanceEmpty: { height: 76 }, performanceLatest: { fontFamily: "Garet-Book", fontSize: 22 }, performanceCaption: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 12, marginTop: 4 },
  settingsKicker: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 10, letterSpacing: 1.8, marginTop: 28, marginBottom: 14 }, settings: { gap: 28 }, settingCard: {}, settingTopRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }, settingLabel: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 16 }, settingValue: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", fontSize: 19 }, settingHint: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 11, marginTop: 8 }, choiceRow: { flexDirection: "row", gap: 8 }, choiceButton: { flex: 1, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.035)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" }, choiceButtonSelected: { backgroundColor: "rgba(255,255,255,0.11)", borderColor: "rgba(255,255,255,0.28)" }, choiceText: { color: SPACE_CADET.textTertiary, fontFamily: "Garet-Book", fontSize: 18 }, choiceTextCompact: { fontFamily: "Gontserrat-Regular", fontSize: 11, letterSpacing: 0.45 }, choiceTextSelected: { color: SPACE_CADET.white }, tapeFrame: { height: 64, justifyContent: "center", overflow: "hidden" }, tapeItem: { width: TAPE_ITEM_WIDTH, height: 64, justifyContent: "center", alignItems: "center" }, tapeText: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 23 }, tapeTextWord: { fontFamily: "Gontserrat-Light", fontSize: 11, letterSpacing: 1.1 }, sliderLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: -3 }, sliderText: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 11 },
  fixedFooter: { position: "absolute", right: 0, bottom: 0, left: 0, paddingHorizontal: 20, paddingTop: 26, paddingBottom: 34, backgroundColor: SPACE_CADET.black, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(255,255,255,0.06)" }, button: { minHeight: 54, paddingHorizontal: 24, borderRadius: 999, alignItems: "center", justifyContent: "center", borderWidth: 1 }, primary: { backgroundColor: SPACE_CADET.white, borderColor: SPACE_CADET.white }, secondary: { backgroundColor: "transparent", borderColor: "rgba(255,255,255,0.24)" }, buttonText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 16 }, primaryButtonText: { color: SPACE_CADET.black }, startButton: { marginTop: 22 }, pressed: { transform: [{ scale: 0.97 }] },
  sheetBackdrop: { flex: 1, justifyContent: "flex-end" }, backdropDim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.58)" }, rulesSheet: { minHeight: "50%", maxHeight: "88%", padding: 20, paddingBottom: 20, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: SPACE_CADET.surface2 }, sheetHandle: { width: 38, height: 4, borderRadius: 2, alignSelf: "center", backgroundColor: SPACE_CADET.textTertiary, marginBottom: 18 }, rulesContent: { flexGrow: 1, paddingBottom: 14 }, sheetTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 25 }, sheetGameTitle: { fontFamily: "Gontserrat-SemiBold", fontSize: 12, letterSpacing: 1.4, textTransform: "uppercase", marginTop: 22 }, rulesText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 15, lineHeight: 23, marginTop: 10 }, difficultyRule: { alignItems: "center", marginTop: 22 }, difficultyRuleLabel: { fontFamily: "Gontserrat-SemiBold", fontSize: 11, letterSpacing: 1.7 }, difficultyRuleText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 6, maxWidth: 310 },
});

export const setupStyles = { sliderLabels: styles.sliderLabels, sliderText: styles.sliderText };
