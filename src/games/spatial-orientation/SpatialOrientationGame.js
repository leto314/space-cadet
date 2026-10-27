import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useEffect, useRef, useState } from "react";
import Svg, { Polygon } from "react-native-svg";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { CubeRenderer } from "./CubeRenderer";
import { CubeNetRenderer } from "./CubeNetRenderer";
import { buildRotationMatrix, buildRun, DIFFICULTY_OPTIONS, easeInOut, getAnswerLabel, getTrackedFacePosition, getVoiceLabel, identityMatrix, multiplyMatrices, rotateOrientation, snapMatrix, START_ORIENTATION } from "./logic";
import { endVoiceSession, say, startVoiceSession, stopSpeaking } from "../../utils/voice";
import { triggerSelectionHaptic } from "../../utils/haptics";
import { GameSetupShell, PickerSetting } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { randomSeed } from "../../utils/random";

export function SpatialOrientationGame({ onExit }) {
  const [selectedDifficulty, setSelectedDifficulty] = useState(DIFFICULTY_OPTIONS[0]);
  const [moveCount, setMoveCount] = useState(7);
  const [phase, setPhase] = useState("difficulty");
  const [orientation, setOrientation] = useState(START_ORIENTATION);
  const [cubeMatrix, setCubeMatrix] = useState(identityMatrix);
  const [pulseLevel, setPulseLevel] = useState(0);
  const [unfoldProgress, setUnfoldProgress] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [result, setResult] = useState(null);
  const [isReturning, setIsReturning] = useState(false);

  const trackedFaceRef = useRef("front");
  const orientationRef = useRef(orientation);
  const matrixRef = useRef(identityMatrix);
  const timeouts = useRef([]);
  const rotationFrameRef = useRef(null);
  const pulseFrameRef = useRef(null);
  const unfoldFrameRef = useRef(null);
  const missionTranslateX = useSharedValue(0);
  const missionOpacity = useSharedValue(0);
  const preflightTranslateX = useSharedValue(0);
  const preflightOpacity = useSharedValue(1);
  const missionTransitionStyle = useAnimatedStyle(() => ({
    opacity: missionOpacity.value,
    transform: [{ translateX: missionTranslateX.value }],
  }));
  const preflightTransitionStyle = useAnimatedStyle(() => ({
    opacity: preflightOpacity.value,
    transform: [{ translateX: preflightTranslateX.value }],
  }));

  useEffect(() => {
    orientationRef.current = orientation;
  }, [orientation]);

  useEffect(() => {
    if (phase !== "preview") {
      setPulseLevel(0);
      if (pulseFrameRef.current) {
        cancelAnimationFrame(pulseFrameRef.current);
        pulseFrameRef.current = null;
      }
      return;
    }

    let mounted = true;
    const startedAt = Date.now();

    const tick = () => {
      if (!mounted) {
        return;
      }

      const elapsed = Date.now() - startedAt;
      const wave = (Math.sin((elapsed / 1800) * Math.PI * 2 - Math.PI / 2) + 1) / 2;
      setPulseLevel(wave);
      pulseFrameRef.current = requestAnimationFrame(tick);
    };

    tick();

    return () => {
      mounted = false;
      if (pulseFrameRef.current) {
        cancelAnimationFrame(pulseFrameRef.current);
        pulseFrameRef.current = null;
      }
    };
  }, [phase]);

  useEffect(() => {
    return () => {
      timeouts.current.forEach(clearTimeout);

      if (rotationFrameRef.current) {
        cancelAnimationFrame(rotationFrameRef.current);
      }

      if (pulseFrameRef.current) {
        cancelAnimationFrame(pulseFrameRef.current);
      }

      if (unfoldFrameRef.current) {
        cancelAnimationFrame(unfoldFrameRef.current);
      }

      endVoiceSession();
    };
  }, []);

  function clearPendingTimeouts() {
    timeouts.current.forEach(clearTimeout);
    timeouts.current = [];
  }

  function stopRotationAnimation() {
    if (rotationFrameRef.current) {
      cancelAnimationFrame(rotationFrameRef.current);
      rotationFrameRef.current = null;
    }
  }

  function stopUnfoldAnimation() {
    if (unfoldFrameRef.current) {
      cancelAnimationFrame(unfoldFrameRef.current);
      unfoldFrameRef.current = null;
    }
  }

  function resetRun(nextDifficulty = selectedDifficulty) {
    clearPendingTimeouts();
    stopRotationAnimation();
    stopUnfoldAnimation();
    stopSpeaking();
    trackedFaceRef.current = "front";
    matrixRef.current = identityMatrix;
    setCubeMatrix(identityMatrix);
    setSelectedDifficulty(nextDifficulty);
    setOrientation(START_ORIENTATION);
    setPulseLevel(0);
    setUnfoldProgress(0);
    setStepIndex(0);
    setResult(null);
    setPhase(nextDifficulty ? "preview" : "difficulty");
  }

  function completeReturnToPreflight() {
    missionTranslateX.value = 0;
    missionOpacity.value = 0;
    preflightOpacity.value = 1;
    resetRun(selectedDifficulty);
    setPhase("difficulty");
    setIsReturning(false);
  }

  function returnToPreflight() {
    if (isReturning) {
      return;
    }

    clearPendingTimeouts();
    stopRotationAnimation();
    stopUnfoldAnimation();
    stopSpeaking();
    preflightTranslateX.value = -18;
    preflightOpacity.value = 0.72;
    missionOpacity.value = 1;
    setIsReturning(true);

    requestAnimationFrame(() => {
      const transitionConfig = { duration: 280, easing: Easing.bezier(0.22, 0.61, 0.36, 1) };
      preflightTranslateX.value = withTiming(0, transitionConfig);
      preflightOpacity.value = withTiming(1, transitionConfig);
      missionOpacity.value = withTiming(0.94, transitionConfig);
      missionTranslateX.value = withTiming(440, transitionConfig, (finished) => {
        if (finished) {
          runOnJS(completeReturnToPreflight)();
        }
      });
    });
  }

  function startMission() {
    missionTranslateX.value = 0;
    missionOpacity.value = 0;
    preflightOpacity.value = 1;
    resetRun(selectedDifficulty);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        missionOpacity.value = withTiming(1, {
          duration: 336,
          easing: Easing.out(Easing.cubic),
        });
      });
    });
  }

  function animateCubeRotation(axis, direction, duration, onComplete) {
    stopRotationAnimation();

    const startedAt = Date.now();
    const baseMatrix = matrixRef.current;

    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeInOut(progress);
      const rotationMatrix = buildRotationMatrix(axis, direction * 90 * eased);

      setCubeMatrix(multiplyMatrices(rotationMatrix, baseMatrix));

      if (progress < 1) {
        rotationFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      const finalMatrix = snapMatrix(multiplyMatrices(buildRotationMatrix(axis, direction * 90), baseMatrix));
      matrixRef.current = finalMatrix;
      setCubeMatrix(finalMatrix);
      rotationFrameRef.current = null;
      onComplete();
    };

    rotationFrameRef.current = requestAnimationFrame(tick);
  }

  function animateUnfold(duration, onComplete) {
    stopUnfoldAnimation();

    const startedAt = Date.now();

    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const progress = Math.min(elapsed / duration, 1);

      setUnfoldProgress(easeInOut(progress));

      if (progress < 1) {
        unfoldFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      unfoldFrameRef.current = null;
      onComplete();
    };

    unfoldFrameRef.current = requestAnimationFrame(tick);
  }

  function announceTurn(turn) {
    void startVoiceSession().then(() => say(getVoiceLabel(turn), { language: "en-US", pitch: 1, rate: 0.92 }));
  }

  function startSequence() {
    if (!selectedDifficulty) {
      return;
    }

    clearPendingTimeouts();
    stopRotationAnimation();
    stopUnfoldAnimation();
    stopSpeaking();
    setPhase("settling");
    setStepIndex(0);
    setResult(null);
    setUnfoldProgress(0);

    const sequence = buildRun({ moveCount }, randomSeed());

    const runTurn = (index) => {
      if (index >= sequence.length) {
        setPhase("unfolding");
        animateUnfold(1800, () => {
          setPhase("answer");
        });
        return;
      }

      const turn = sequence[index];
      setStepIndex(index + 1);
      announceTurn(turn);

      if (selectedDifficulty.visual) {
        animateCubeRotation(turn.axis, turn.direction, selectedDifficulty.rotationMs, () => {
          const nextOrientation = rotateOrientation(orientationRef.current, turn.axis, turn.direction);
          orientationRef.current = nextOrientation;
          setOrientation(nextOrientation);

          const timeoutId = setTimeout(() => {
            runTurn(index + 1);
          }, selectedDifficulty.pauseMs);

          timeouts.current.push(timeoutId);
        });
        return;
      }

      const timeoutId = setTimeout(() => {
        const nextOrientation = rotateOrientation(orientationRef.current, turn.axis, turn.direction);
        orientationRef.current = nextOrientation;
        setOrientation(nextOrientation);
        runTurn(index + 1);
      }, selectedDifficulty.rotationMs + selectedDifficulty.pauseMs);

      timeouts.current.push(timeoutId);
    };

    const timeoutId = setTimeout(() => {
      setPhase("running");
      runTurn(0);
    }, 1500);

    timeouts.current.push(timeoutId);
  }

  async function submitAnswer(answer) {
    if (phase !== "answer") {
      return;
    }

    await triggerSelectionHaptic();
    const correctAnswer = getTrackedFacePosition(orientationRef.current, trackedFaceRef.current);
    const isCorrect = answer === correctAnswer;

    setResult({
      selected: answer,
      correct: correctAnswer,
      isCorrect,
    });
    setPhase("result");
  }

  const preflightScreen = (
    <GameSetupShell title="Cube Rotation" categoryKey="spatial" onExit={onExit} onStart={startMission} rules="Tests spatial tracking. Follow the marked face as the cube rotates, then identify its final position. Easy: the cube stays visible at a steady pace. Medium: visible rotations move quickly with audio cues. Hard: directions are hidden and delivered at a fast pace.">
      <PickerSetting label="Difficulty" options={DIFFICULTY_OPTIONS.map((option, index) => ({ value: option, label: ["EASY", "MEDIUM", "HARD"][index] }))} value={selectedDifficulty} onChange={setSelectedDifficulty} />
      <PickerSetting label="Moves" options={Array.from({ length: 12 }, (_, index) => ({ value: index + 4, label: String(index + 4) }))} value={moveCount} onChange={setMoveCount} />
    </GameSetupShell>
  );

  return (
    <View style={styles.container}>
      {phase === "difficulty" || isReturning ? (
        <Animated.View style={[styles.preflightLayer, isReturning && preflightTransitionStyle]}>
          {preflightScreen}
        </Animated.View>
      ) : null}

      {phase !== "difficulty" ? (
      <Animated.View
        pointerEvents={isReturning ? "none" : "auto"}
        style={[styles.missionScreen, missionTransitionStyle]}
      >
      <View style={styles.headerRow}><Pressable onPress={returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable></View>

      {phase !== "difficulty" ? (
        <View style={styles.gamePanel}>
          <Pressable disabled={phase !== "preview"} onPress={startSequence} style={styles.gameBody}>
            <Text style={styles.gameKicker}>{phase === "preview" ? "SPATIAL ORIENTATION" : phase === "answer" ? "FINAL POSITION" : `MOVE ${Math.min(stepIndex, moveCount)} / ${moveCount}`}</Text>
            <Text style={styles.instruction}>
              {phase === "preview" ? "Ready to track the cube?" : null}
              {phase === "settling" ? "Focus" : null}
              {phase === "running" ? selectedDifficulty.visual ? "Watch the rotation" : "Listen to the direction" : null}
              {phase === "unfolding" ? "Unfolding the cube" : null}
              {phase === "answer" ? "Where is the marked face?" : null}
              {phase === "result" && result?.isCorrect ? "Correct" : null}
              {phase === "result" && result && !result.isCorrect ? "Not quite" : null}
            </Text>

            <Text style={styles.helperText}>
              {phase === "preview"
                ? "Track the blue front face through every rotation."
                : null}
              {phase === "settling"
                ? "The sequence begins in a moment."
                : null}
              {phase === "running"
                ? selectedDifficulty.visual
                  ? null
                  : "Keep the cube in mind from the audio cues."
                : null}
              {phase === "unfolding"
                ? "Find the marked face in the net."
                : null}
              {phase === "answer"
                ? "Tap the matching panel."
                : null}
              {phase === "result" && result?.isCorrect
                ? `The marked face finished on the ${getAnswerLabel(result.correct)}.`
                : null}
              {phase === "result" && result && !result.isCorrect
                ? `You chose ${getAnswerLabel(result.selected)}. It was ${getAnswerLabel(result.correct)}.`
                : null}
            </Text>

            <PulsingPrompt
              color={SPACE_CADET.spatial}
              style={[styles.startPrompt, phase !== "preview" && styles.startPromptPlaceholder]}
            >
              {phase === "preview" ? "TAP ANYWHERE TO BEGIN" : " "}
            </PulsingPrompt>

            <View
              style={[
                styles.cubeStage,
                phase === "preview" && styles.cubeStageActive,
                (phase === "unfolding" || phase === "answer" || phase === "result") && styles.netStage,
              ]}
            >
            {phase === "preview" || phase === "settling" || phase === "running" ? (
              <CubeRenderer
                matrix={selectedDifficulty.visual || phase === "preview" ? cubeMatrix : identityMatrix}
                pulseLevel={pulseLevel}
                highlightFace={phase === "preview" ? "front" : null}
                accent={SPACE_CADET.spatial}
                />
              ) : (
                <CubeNetRenderer
                  progress={unfoldProgress}
                  onSelect={submitAnswer}
                  disabled={phase !== "answer"}
                  result={phase === "result" ? result : null}
                />
              )}
            </View>
          </Pressable>

          <View style={styles.footerActions}>
            {phase === "result" ? (
              <>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => resetRun(selectedDifficulty)}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryButtonText}>Play again</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={returnToPreflight}
                  style={styles.secondaryButtonSecondary}
                >
                  <Text style={styles.secondaryButtonSecondaryText}>Change settings</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </View>
      ) : null}
      </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: SPACE_CADET.black,
  },
  missionScreen: {
    flex: 1,
    backgroundColor: SPACE_CADET.black,
    zIndex: 2,
  },
  preflightLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
  },
  headerRow: {
    height: 64,
    paddingHorizontal: 20,
    justifyContent: "center",
  },
  backButton: {
    width: 44,
    height: 44,
    position: "absolute",
    left: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  backArrow: {
    color: SPACE_CADET.white,
    fontFamily: "Gontserrat-Light",
    fontSize: 32,
    lineHeight: 36,
  },
  pressed: {
    transform: [{ scale: 0.97 }],
  },
  gamePanel: {
    flex: 1,
    width: "100%",
    paddingHorizontal: 20,
  },
  gameBody: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 70,
  },
  gameKicker: {
    color: SPACE_CADET.spatial,
    fontFamily: "Gontserrat-SemiBold",
    fontSize: 10,
    letterSpacing: 1.8,
    marginBottom: 10,
  },
  instruction: {
    minHeight: 34,
    textAlign: "center",
    fontFamily: "Gontserrat-Light",
    fontSize: 27,
    lineHeight: 34,
    color: SPACE_CADET.white,
    marginBottom: 8,
    maxWidth: 320,
  },
  helperText: {
    minHeight: 44,
    textAlign: "center",
    fontFamily: "Gontserrat-Regular",
    fontSize: 14,
    lineHeight: 22,
    color: SPACE_CADET.textSecondary,
    maxWidth: 320,
    marginBottom: 16,
  },
  startPrompt: {
    color: SPACE_CADET.spatial,
    fontSize: 12,
    height: 24,
    lineHeight: 16,
    textAlign: "center",
    letterSpacing: 1.8,
    marginBottom: 14,
  },
  startPromptPlaceholder: {
    opacity: 0,
  },
  cubeStage: {
    width: "100%",
    minHeight: 360,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
    marginTop: -38,
    marginBottom: 10,
  },
  cubeStageActive: {
    backgroundColor: "transparent",
  },
  netStage: {
    minHeight: 360,
  },
  footerActions: {
    width: "100%",
    gap: 12,
    paddingBottom: 18,
    paddingTop: 10,
  },
  secondaryButton: {
    backgroundColor: SPACE_CADET.white,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: "center",
  },
  secondaryButtonText: {
    fontFamily: "Gontserrat-Regular",
    fontSize: 16,
    color: SPACE_CADET.black,
  },
  secondaryButtonSecondary: {
    backgroundColor: "transparent",
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: "center",
    borderWidth: 1,
    borderColor: SPACE_CADET.borderDefault,
  },
  secondaryButtonSecondaryText: {
    fontFamily: "Gontserrat-Regular",
    fontSize: 15,
    color: SPACE_CADET.white,
  },
});
