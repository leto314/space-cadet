import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useEffect, useRef, useState } from "react";
import Slider from "@react-native-community/slider";
import Svg, { Polygon } from "react-native-svg";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { CubeRenderer } from "./CubeRenderer";
import { endVoiceSession, say, startVoiceSession, stopSpeaking } from "../../utils/voice";
import { triggerSelectionHaptic } from "../../utils/haptics";
import { GameSetupShell, PickerSetting } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { SPACE_CADET } from "../../theme/spaceCadet";

const difficultyOptions = [
  { key: "easy", label: "Easy", rotationMs: 1100, pauseMs: 1500, visual: true },
  { key: "medium", label: "Medium", rotationMs: 660, pauseMs: 780, visual: true },
  { key: "hard", label: "Hard", rotationMs: 760, pauseMs: 900, visual: false },
];

export const identityMatrix = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

const answerLabels = {
  top: "top",
  left: "left",
  front: "front",
  right: "right",
  bottom: "bottom",
  back: "back",
};

export function easeInOut(progress) {
  return 0.5 - Math.cos(Math.PI * progress) / 2;
}

function degreesToRadians(value) {
  return (value * Math.PI) / 180;
}

export function multiplyMatrices(left, right) {
  return [
    [
      left[0][0] * right[0][0] + left[0][1] * right[1][0] + left[0][2] * right[2][0],
      left[0][0] * right[0][1] + left[0][1] * right[1][1] + left[0][2] * right[2][1],
      left[0][0] * right[0][2] + left[0][1] * right[1][2] + left[0][2] * right[2][2],
    ],
    [
      left[1][0] * right[0][0] + left[1][1] * right[1][0] + left[1][2] * right[2][0],
      left[1][0] * right[0][1] + left[1][1] * right[1][1] + left[1][2] * right[2][1],
      left[1][0] * right[0][2] + left[1][1] * right[1][2] + left[1][2] * right[2][2],
    ],
    [
      left[2][0] * right[0][0] + left[2][1] * right[1][0] + left[2][2] * right[2][0],
      left[2][0] * right[0][1] + left[2][1] * right[1][1] + left[2][2] * right[2][1],
      left[2][0] * right[0][2] + left[2][1] * right[1][2] + left[2][2] * right[2][2],
    ],
  ];
}

export function buildRotationMatrix(axis, degrees) {
  const radians = degreesToRadians(degrees);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  if (axis === "x") {
    return [
      [1, 0, 0],
      [0, cos, -sin],
      [0, sin, cos],
    ];
  }

  if (axis === "y") {
    return [
      [cos, 0, sin],
      [0, 1, 0],
      [-sin, 0, cos],
    ];
  }

  return [
    [cos, -sin, 0],
    [sin, cos, 0],
    [0, 0, 1],
  ];
}

function snapValue(value) {
  if (Math.abs(value) < 0.0001) {
    return 0;
  }

  if (Math.abs(value - 1) < 0.0001) {
    return 1;
  }

  if (Math.abs(value + 1) < 0.0001) {
    return -1;
  }

  return value;
}

export function snapMatrix(matrix) {
  return matrix.map((row) => row.map((value) => snapValue(value)));
}

function buildRandomSequence(turns) {
  const axes = ["x", "y", "z"];
  const sequence = [];
  let previous = null;

  for (let index = 0; index < turns; index += 1) {
    let next = null;

    while (!next || (previous && previous.axis === next.axis && previous.direction === -next.direction)) {
      next = {
        axis: axes[Math.floor(Math.random() * axes.length)],
        direction: Math.random() > 0.5 ? 1 : -1,
      };
    }

    sequence.push(next);
    previous = next;
  }

  return sequence;
}

export function rotateOrientation(orientation, axis, direction) {
  if (axis === "y") {
    if (direction === 1) {
      return {
        front: orientation.left,
        right: orientation.front,
        back: orientation.right,
        left: orientation.back,
        top: orientation.top,
        bottom: orientation.bottom,
      };
    }

    return {
      front: orientation.right,
      right: orientation.back,
      back: orientation.left,
      left: orientation.front,
      top: orientation.top,
      bottom: orientation.bottom,
    };
  }

  if (axis === "z") {
    if (direction === 1) {
      return {
        front: orientation.front,
        back: orientation.back,
        top: orientation.right,
        left: orientation.top,
        bottom: orientation.left,
        right: orientation.bottom,
      };
    }

    return {
      front: orientation.front,
      back: orientation.back,
      top: orientation.left,
      left: orientation.bottom,
      bottom: orientation.right,
      right: orientation.top,
    };
  }

  if (direction === 1) {
    return {
      front: orientation.top,
      top: orientation.back,
      back: orientation.bottom,
      bottom: orientation.front,
      left: orientation.left,
      right: orientation.right,
    };
  }

  return {
    front: orientation.bottom,
    top: orientation.front,
    back: orientation.top,
    bottom: orientation.back,
    left: orientation.left,
    right: orientation.right,
  };
}

export function getTrackedFacePosition(orientation, trackedFace) {
  return Object.keys(orientation).find((position) => orientation[position] === trackedFace);
}

export function getAnswerLabel(answerKey) {
  return answerLabels[answerKey] ?? answerKey;
}

export function getVoiceLabel(turn) {
  if (turn.axis === "y") {
    return turn.direction === 1 ? "right" : "left";
  }

  if (turn.axis === "x") {
    return turn.direction === 1 ? "down" : "up";
  }

  return turn.direction === 1 ? "counterclockwise" : "clockwise";
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function pointsToString(points) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function buildFrontSquare(size, centerX, centerY) {
  return {
    topLeft: { x: centerX - size / 2, y: centerY - size / 2 },
    topRight: { x: centerX + size / 2, y: centerY - size / 2 },
    bottomRight: { x: centerX + size / 2, y: centerY + size / 2 },
    bottomLeft: { x: centerX - size / 2, y: centerY + size / 2 },
  };
}

function interpolatePoint(start, end, progress) {
  return {
    x: start.x + (end.x - start.x) * progress,
    y: start.y + (end.y - start.y) * progress,
  };
}

function buildNetPolygon(faceKey, frontSquare, size, sideProgress, topProgress, backProgress) {
  const topOuterLeft = { x: frontSquare.topLeft.x, y: frontSquare.topLeft.y - size * topProgress };
  const topOuterRight = { x: frontSquare.topRight.x, y: frontSquare.topRight.y - size * topProgress };
  const bottomOuterLeft = { x: frontSquare.bottomLeft.x, y: frontSquare.bottomLeft.y + size * sideProgress };
  const bottomOuterRight = { x: frontSquare.bottomRight.x, y: frontSquare.bottomRight.y + size * sideProgress };
  const leftOuterTop = { x: frontSquare.topLeft.x - size * sideProgress, y: frontSquare.topLeft.y };
  const leftOuterBottom = { x: frontSquare.bottomLeft.x - size * sideProgress, y: frontSquare.bottomLeft.y };
  const rightOuterTop = { x: frontSquare.topRight.x + size * sideProgress, y: frontSquare.topRight.y };
  const rightOuterBottom = { x: frontSquare.bottomRight.x + size * sideProgress, y: frontSquare.bottomRight.y };

  if (faceKey === "front") {
    return [
      frontSquare.topLeft,
      frontSquare.topRight,
      frontSquare.bottomRight,
      frontSquare.bottomLeft,
    ];
  }

  if (faceKey === "top") {
    return [topOuterLeft, topOuterRight, frontSquare.topRight, frontSquare.topLeft];
  }

  if (faceKey === "bottom") {
    return [frontSquare.bottomLeft, frontSquare.bottomRight, bottomOuterRight, bottomOuterLeft];
  }

  if (faceKey === "left") {
    return [leftOuterTop, frontSquare.topLeft, frontSquare.bottomLeft, leftOuterBottom];
  }

  if (faceKey === "right") {
    return [frontSquare.topRight, rightOuterTop, rightOuterBottom, frontSquare.bottomRight];
  }

  const backTopLeft = interpolatePoint(topOuterLeft, { x: topOuterLeft.x, y: topOuterLeft.y - size }, backProgress);
  const backTopRight = interpolatePoint(
    topOuterRight,
    { x: topOuterRight.x, y: topOuterRight.y - size },
    backProgress
  );

  return [backTopLeft, backTopRight, topOuterRight, topOuterLeft];
}

function getNetFill(faceKey, result) {
  if (!result) {
    return SPACE_CADET.surface2;
  }

  if (result.correct === faceKey) {
    return "#123329";
  }

  if (result.selected === faceKey && result.selected !== result.correct) {
    return "#3A1720";
  }

  return SPACE_CADET.surface2;
}

function mixHexColor(start, end, progress) {
  const ratio = clamp(progress, 0, 1);
  const channels = [0, 2, 4].map((offset) => {
    const from = parseInt(start.slice(offset + 1, offset + 3), 16);
    const to = parseInt(end.slice(offset + 1, offset + 3), 16);
    return Math.round(from + (to - from) * ratio)
      .toString(16)
      .padStart(2, "0");
  });

  return `#${channels.join("")}`;
}

function getNetBaseStroke(progress) {
  return mixHexColor(SPACE_CADET.spatial, "#626978", progress / 0.76);
}

export function CubeNetRenderer({ progress, onSelect, disabled, result }) {
  const viewportWidth = 280;
  const viewportHeight = 360;
  const finalSize = 68;
  const startSize = 156;
  const zoomProgress = clamp(progress / 0.28, 0, 1);
  const sideProgress = clamp((progress - 0.28) / 0.3, 0, 1);
  const topProgress = clamp((progress - 0.58) / 0.18, 0, 1);
  const backProgress = clamp((progress - 0.76) / 0.24, 0, 1);
  const size = startSize + (finalSize - startSize) * zoomProgress;
  const centerX = viewportWidth / 2;
  const centerY = 180 + 10 * zoomProgress;
  const frontSquare = buildFrontSquare(size, centerX, centerY);
  const faces = ["back", "top", "left", "front", "right", "bottom"];
  const getFacePoints = (face) =>
    pointsToString(buildNetPolygon(face, frontSquare, size, sideProgress, topProgress, backProgress));
  const highlightedFaces = result
    ? [
        { key: result.correct, color: "#34D399" },
        ...(result.selected !== result.correct ? [{ key: result.selected, color: "#D64045" }] : []),
      ]
    : [];

  return (
    <View style={styles.netWrapper}>
      <Svg width={viewportWidth} height={viewportHeight} viewBox={`0 0 ${viewportWidth} ${viewportHeight}`}>
        {faces.map((face) => (
          <Polygon
            key={face}
            points={getFacePoints(face)}
            fill={getNetFill(face, result)}
            stroke={getNetBaseStroke(progress)}
            strokeWidth="2"
            strokeLinejoin="round"
            onPress={!disabled ? () => onSelect(face) : undefined}
          />
        ))}
        {highlightedFaces.map((face) => (
          <Polygon
            key={`${face.key}-result-outline`}
            points={getFacePoints(face.key)}
            fill="none"
            stroke={face.color}
            strokeWidth="3.5"
            strokeLinejoin="round"
            pointerEvents="none"
          />
        ))}
      </Svg>
    </View>
  );
}

export function SpatialOrientationGame({ onExit }) {
  const [selectedDifficulty, setSelectedDifficulty] = useState(difficultyOptions[0]);
  const [moveCount, setMoveCount] = useState(7);
  const [phase, setPhase] = useState("difficulty");
  const [orientation, setOrientation] = useState({
    front: "front",
    back: "back",
    left: "left",
    right: "right",
    top: "top",
    bottom: "bottom",
  });
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
    setOrientation({
      front: "front",
      back: "back",
      left: "left",
      right: "right",
      top: "top",
      bottom: "bottom",
    });
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

    const sequence = buildRandomSequence(moveCount);

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
      <PickerSetting label="Difficulty" options={difficultyOptions.map((option, index) => ({ value: option, label: ["EASY", "MEDIUM", "HARD"][index] }))} value={selectedDifficulty} onChange={setSelectedDifficulty} />
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

      {phase === "difficulty" ? (
        <View style={styles.centerPanel}>
          <Text style={styles.sectionTitle}>Choix de la difficulte</Text>
          <Text style={styles.sectionSubtitle}>
            Les niveaux changent surtout le rythme et le nombre de rotations.
          </Text>

          <View style={styles.sliderBlock}>
            <Text style={styles.sliderLabel}>Nombre de mouvements</Text>
            <Text style={styles.sliderValue}>{moveCount}</Text>
            <Slider
              minimumValue={4}
              maximumValue={15}
              step={1}
              value={moveCount}
              minimumTrackTintColor="#1F2A37"
              maximumTrackTintColor="#D7CEC0"
              thumbTintColor="#8D6E4F"
              onValueChange={setMoveCount}
            />
            <View style={styles.sliderExtremes}>
              <Text style={styles.sliderExtremeText}>4</Text>
              <Text style={styles.sliderExtremeText}>15</Text>
            </View>
          </View>

          <View style={styles.difficultyRow}>
            {difficultyOptions.map((option) => {
              const isSelected = selectedDifficulty?.key === option.key;

              return (
                <TouchableOpacity
                  key={option.key}
                  activeOpacity={0.9}
                  onPress={() => resetRun(option)}
                  style={[styles.difficultyChip, isSelected && styles.difficultyChipSelected]}
                >
                  <Text
                    style={[
                      styles.difficultyChipText,
                      isSelected && styles.difficultyChipTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

        </View>
      ) : null}

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
  centerPanel: {
    flex: 1,
    justifyContent: "center",
  },
  sectionTitle: {
    fontSize: 32,
    fontWeight: "700",
    color: "#1F2A37",
    marginBottom: 12,
    textAlign: "center",
  },
  sectionSubtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: "#5B6573",
    marginBottom: 22,
    textAlign: "center",
  },
  sliderBlock: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 18,
  },
  sliderLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1F2A37",
    marginBottom: 4,
  },
  sliderValue: {
    fontSize: 28,
    fontWeight: "700",
    color: "#8D6E4F",
    marginBottom: 6,
  },
  sliderExtremes: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -4,
  },
  sliderExtremeText: {
    fontSize: 12,
    color: "#8E897F",
  },
  difficultyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  difficultyChip: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    borderWidth: 2,
    borderColor: "transparent",
  },
  difficultyChipSelected: {
    backgroundColor: "#1F2A37",
    borderColor: "#1F2A37",
  },
  difficultyChipText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1F2A37",
  },
  difficultyChipTextSelected: {
    color: "#F4EFE6",
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
  netWrapper: {
    width: 280,
    height: 360,
    alignItems: "center",
    justifyContent: "center",
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
