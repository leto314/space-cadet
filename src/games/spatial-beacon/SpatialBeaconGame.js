import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import Svg, { Circle, G, Line, Path, Polygon, Text as SvgText } from "react-native-svg";
import Animated, { FadeIn } from "react-native-reanimated";

import { triggerSelectionHaptic } from "../../utils/haptics";
import { randomSeed } from "../../utils/random";
import { GameSetupShell, PickerSetting } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { angleToRadians, buildDailyTrials, buildSession, dailyResult, DAILY_STAGES, DEFAULT_ROUNDS, getAngleFromDrag, releasedInSlot, sessionSummary, SLOT_DEFINITIONS } from "./logic";

const THEME_LIGHT = SPACE_CADET.black;
const THEME_DARK = SPACE_CADET.white;
const THEME_MUTED = SPACE_CADET.textSecondary;
const THEME_ACCENT = SPACE_CADET.spatial;
const SUCCESS = "#34D399";
const ERROR = SPACE_CADET.attention;

const difficultyOptions = [
  {
    key: "easy",
    label: "EASY",
    subtitle: "Read the heading and select the correctly oriented aircraft.",
    introTitle: "Heading match",
    example: "Read the gyro, then choose the aircraft pointing in the same direction.",
  },
  {
    key: "medium",
    label: "MEDIUM",
    subtitle: "Combine the aircraft heading and beacon bearing in the matrix.",
    introTitle: "Relative position",
    example: "Place the aircraft around the beacon in the correct relative position.",
  },
  {
    key: "hard",
    label: "HARD",
    subtitle: "First select the heading, then drag from the beacon to the correct position.",
    introTitle: "Two-stage navigation",
    example: "Select the correct heading, then drag outward from the central beacon.",
  },
];

function AircraftIcon({ size = 80, color = THEME_DARK }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path
        d="M50 8 L66 87 L50 71 L34 87 Z"
        fill={color}
        stroke={color}
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function GyroCompass({ heading, size = 168 }) {
  const center = size / 2;
  const radius = size / 2 - 10;
  const tickAngles = Array.from({ length: 24 }, (_, index) => index * 15);

  return (
    <View style={[styles.instrumentShell, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={center} cy={center} r={radius} fill={THEME_LIGHT} stroke={THEME_ACCENT} strokeWidth="1.25" />
        <G rotation={-heading} origin={`${center}, ${center}`}>
          {tickAngles.map((angle) => {
            const outerRadius = radius - 8;
            const isMajorTick = angle % 45 === 0;
            const innerRadius = isMajorTick ? radius - 18 : radius - 13;
            const radians = angleToRadians(angle);
            const x1 = center + Math.sin(radians) * innerRadius;
            const y1 = center - Math.cos(radians) * innerRadius;
            const x2 = center + Math.sin(radians) * outerRadius;
            const y2 = center - Math.cos(radians) * outerRadius;

            return (
              <Line
                key={`gyro-tick-${angle}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={isMajorTick ? THEME_ACCENT : THEME_DARK}
                strokeWidth={isMajorTick ? 1.35 : 0.7}
                strokeLinecap="round"
              />
            );
          })}

          {[
            { label: "N", angle: 0 },
            { label: "E", angle: 90 },
            { label: "S", angle: 180 },
            { label: "W", angle: 270 },
          ].map((cardinal) => {
            const radians = angleToRadians(cardinal.angle);
            const textRadius = radius - 32;
            const x = center + Math.sin(radians) * textRadius;
            const y = center - Math.cos(radians) * textRadius + 5;

            return (
              <SvgText
                key={`gyro-cardinal-${cardinal.label}`}
                x={x}
                y={y}
                fill={THEME_ACCENT}
                fontSize="14"
                fontFamily="Gontserrat-SemiBold"
                textAnchor="middle"
              >
                {cardinal.label}
              </SvgText>
            );
          })}
        </G>
      </Svg>

      <View style={styles.centerAircraft}>
        <AircraftIcon size={64} />
      </View>
    </View>
  );
}

function RelativeBearingDial({ bearing, size = 168 }) {
  const center = size / 2;
  const radius = size / 2 - 10;
  const arrowRadius = radius - 26;
  const arrowAngle = angleToRadians(bearing);
  const tipX = center + Math.sin(arrowAngle) * arrowRadius;
  const tipY = center - Math.cos(arrowAngle) * arrowRadius;

  return (
    <View style={[styles.instrumentShell, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={center} cy={center} r={radius} fill={THEME_LIGHT} stroke={THEME_DARK} strokeWidth="1.25" />
        {Array.from({ length: 24 }, (_, index) => index * 15).map((angle) => {
          const radians = angleToRadians(angle);
          const outerRadius = radius - 8;
          const isMajorTick = angle % 45 === 0;
          const innerRadius = isMajorTick ? radius - 18 : radius - 13;
          const x1 = center + Math.sin(radians) * innerRadius;
          const y1 = center - Math.cos(radians) * innerRadius;
          const x2 = center + Math.sin(radians) * outerRadius;
          const y2 = center - Math.cos(radians) * outerRadius;

          return (
            <Line
              key={`bearing-tick-${angle}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={THEME_DARK}
              strokeWidth={isMajorTick ? "1.35" : "0.7"}
              strokeLinecap="round"
            />
          );
        })}

        <Polygon points={`${center},${17} ${center - 5},${28} ${center + 5},${28}`} fill={THEME_ACCENT} />
        <Line x1={center} y1={center} x2={tipX} y2={tipY} stroke={THEME_ACCENT} strokeWidth="2.35" strokeLinecap="round" />
        <Circle cx={center} cy={center} r="3.5" fill={THEME_ACCENT} />
      </Svg>
    </View>
  );
}

function AircraftPoseCard({
  angle,
  onPress,
  onPressIn,
  status = "idle",
  hidden = false,
  enlarged = false,
  disabled = false,
  compact = false,
  onLayout,
}) {
  if (hidden) {
    return <View style={styles.posePlaceholder} />;
  }

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      disabled={disabled}
      onPress={onPress}
      onPressIn={onPressIn}
      onLayout={onLayout}
      style={[
        styles.poseCard,
        compact && styles.poseCardCompact,
        enlarged && styles.poseCardLarge,
        status === "correct" && styles.poseCardCorrect,
        status === "wrong" && styles.poseCardWrong,
      ]}
    >
      <View style={{ transform: [{ rotate: `${angle}deg` }] }}>
        <AircraftIcon size={enlarged ? 90 : compact ? 58 : 68} />
      </View>
    </TouchableOpacity>
  );
}

function PlacementMatrix({
  heading,
  onSelect,
  selectedAngle,
  previewAngle,
  selectedStatus,
  correctAngle = null,
  interactive = true,
  dragHandlers = null,
  onMatrixLayout = null,
}) {
  return (
    <View style={styles.matrixWrapper} onLayout={onMatrixLayout}>
      <View style={styles.matrixGrid}>
        {Array.from({ length: 9 }, (_, index) => {
          const row = Math.floor(index / 3);
          const col = index % 3;
          const slot = SLOT_DEFINITIONS.find((item) => item.row === row && item.col === col);
          const isCenter = row === 1 && col === 1;

          if (isCenter) {
            return (
              <View key="beacon-center" style={styles.matrixCell}>
                <View style={styles.beaconOuter} {...(dragHandlers ?? {})}>
                  <View style={styles.beaconMiddle}>
                    <View style={styles.beaconInner} />
                  </View>
                </View>
              </View>
            );
          }

          const shownAngle = selectedAngle === slot.angle ? selectedAngle : previewAngle === slot.angle ? previewAngle : null;
          const isSelected = selectedAngle === slot.angle;
          const isPreview = previewAngle === slot.angle && !isSelected;
          const isCorrectSlot = correctAngle === slot.angle;

          return (
            <TouchableOpacity
              key={slot.key}
              activeOpacity={0.9}
              disabled={!interactive}
              onPress={interactive ? () => onSelect(slot.angle) : undefined}
              style={[
                styles.matrixCell,
                styles.matrixSlot,
                isPreview && styles.matrixSlotPreview,
                !isSelected && selectedStatus === "wrong" && isCorrectSlot && styles.matrixSlotCorrect,
                isSelected && selectedStatus === "correct" && styles.matrixSlotCorrect,
                isSelected && selectedStatus === "wrong" && styles.matrixSlotWrong,
              ]}
            >
              {shownAngle !== null ? (
                <View style={{ transform: [{ rotate: `${heading}deg` }] }}>
                  <AircraftIcon size={44} />
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// `daily` ({ seed, onFinish, onExit }) turns this into the daily training version: no preflight, the day's ten
// rounds in three stages (each introduced by its own ready screen), then onFinish({ score, metrics, trials }).
export function SpatialBeaconGame({ onExit, daily = null }) {
  const [selectedDifficulty, setSelectedDifficulty] = useState(difficultyOptions[0]);
  const [roundCount, setRoundCount] = useState(DEFAULT_ROUNDS);
  const [phase, setPhase] = useState(daily ? "ready" : "difficulty");
  const [trials, setTrials] = useState([]);
  const [trialIndex, setTrialIndex] = useState(0);
  const [results, setResults] = useState([]);
  const [optionStatus, setOptionStatus] = useState(null);
  const [matrixStatus, setMatrixStatus] = useState(null);
  const [hardStage, setHardStage] = useState("choice");
  const [hardSelectedAngle, setHardSelectedAngle] = useState(null);
  const [dragPreviewAngle, setDragPreviewAngle] = useState(null);
  const [dragPlanePosition, setDragPlanePosition] = useState(null);

  const timeouts = useRef([]);
  const hardFallbackRef = useRef(false);
  const stageStartedAtRef = useRef(0);
  const hardStageRef = useRef("choice");
  const hardStage1ReactionRef = useRef(null);
  const beaconCenterRef = useRef(null);
  const hardDragRef = useRef({ active: false, selectedAngle: null });
  const optionLayoutsRef = useRef([]);
  const optionsGridLayoutRef = useRef({ x: 0, y: 0 });
  const hardStageLayoutRef = useRef({ x: 0, y: 0 });
  const hardInteractionRef = useRef(null);
  const hardInteractionOriginRef = useRef({ x: 0, y: 0 });

  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({
    onPrepareReturn: clearTimers,
    onReturnComplete: resetToPreflight,
  });

  const currentTrial = trials[trialIndex] ?? null;
  // The mode of the round on screen: one per session in Full Clearance, it changes by stage in the daily version.
  const mode = currentTrial?.mode ?? selectedDifficulty?.key;
  const totalRounds = daily ? trials.length || 10 : roundCount;
  const readyOption = difficultyOptions.find((option) => option.key === (daily ? trials[trialIndex]?.mode ?? DAILY_STAGES[0].mode : selectedDifficulty?.key)) ?? selectedDifficulty;

  useEffect(() => {
    hardStageRef.current = hardStage;
  }, [hardStage]);

  useEffect(() => {
    return () => {
      timeouts.current.forEach(clearTimeout);
    };
  }, []);

  const summary = useMemo(() => sessionSummary(results, selectedDifficulty?.key), [results, selectedDifficulty]);

  function clearTimers() {
    timeouts.current.forEach(clearTimeout);
    timeouts.current = [];
  }

  function getHardChoiceAngleAtPoint(x, y) {
    const matchedEntry = optionLayoutsRef.current.find((layout) => {
      if (!layout) {
        return false;
      }

      return x >= layout.x && x <= layout.x + layout.width && y >= layout.y && y <= layout.y + layout.height;
    });

    if (!matchedEntry || !currentTrial) {
      return null;
    }

    return currentTrial.optionAngles[matchedEntry.index] ?? null;
  }

  function syncHardInteractionOrigin() {
    hardInteractionRef.current?.measureInWindow?.((x, y) => {
      hardInteractionOriginRef.current = { x, y };
    });
  }

  function getHardLocalPoint(event) {
    const { pageX, pageY } = event.nativeEvent;

    return {
      x: pageX - hardInteractionOriginRef.current.x,
      y: pageY - hardInteractionOriginRef.current.y,
    };
  }

  function updateHardDragPreview(x, y) {
    setDragPlanePosition({ x, y });

    if (!beaconCenterRef.current) {
      setDragPreviewAngle(null);
      return;
    }

    setDragPreviewAngle(getAngleFromDrag(x - beaconCenterRef.current.x, y - beaconCenterRef.current.y));
  }

  function resetRoundState() {
    setOptionStatus(null);
    setMatrixStatus(null);
    setHardStage("choice");
    hardStageRef.current = "choice";
    hardFallbackRef.current = false;
    setHardSelectedAngle(null);
    setDragPreviewAngle(null);
    setDragPlanePosition(null);
    hardStage1ReactionRef.current = null;
    hardDragRef.current = { active: false, selectedAngle: null };
    hardStageLayoutRef.current = { x: 0, y: 0 };
    beaconCenterRef.current = null;
  }

  function resetRun(nextDifficulty = selectedDifficulty) {
    clearTimers();
    setSelectedDifficulty(nextDifficulty);
    setPhase(nextDifficulty ? "ready" : "difficulty");
    setTrials([]);
    setTrialIndex(0);
    setResults([]);
    resetRoundState();
  }

  function resetToPreflight() {
    clearTimers();
    setTrials([]);
    setTrialIndex(0);
    setResults([]);
    resetRoundState();
    setPhase("difficulty");
  }

  function finishDaily(finalResults) { daily.onFinish(dailyResult(finalResults, trials)); }

  function moveToNextTrial(nextResults) {
    const nextIndex = trialIndex + 1;

    if (nextIndex >= totalRounds) {
      setResults(nextResults);
      if (daily) finishDaily(nextResults);
      else setPhase("summary");
      return;
    }

    setResults(nextResults);
    setTrialIndex(nextIndex);
    resetRoundState();
    stageStartedAtRef.current = Date.now();
    // Daily version: a new stage starts with its own ready screen.
    if (daily && trials[nextIndex].mode !== trials[trialIndex].mode) setPhase("ready");
  }

  function scheduleAdvance(nextResults) {
    const timeoutId = setTimeout(() => {
      moveToNextTrial(nextResults);
    }, 650);

    timeouts.current.push(timeoutId);
  }

  function startRun() {
    if (daily && trials.length) {
      setPhase("playing");
      stageStartedAtRef.current = Date.now();
      return;
    }

    if (!selectedDifficulty && !daily) {
      return;
    }

    clearTimers();
    setTrials(daily ? buildDailyTrials(daily.seed) : buildSession({ mode: selectedDifficulty.key, roundCount }, randomSeed()));
    setResults([]);
    setTrialIndex(0);
    resetRoundState();
    setPhase("playing");
    stageStartedAtRef.current = Date.now();
  }

  async function handleEasyChoice(angle) {
    if (!currentTrial || optionStatus) {
      return;
    }

    await triggerSelectionHaptic();
    const correct = angle === currentTrial.heading;
    const nextResults = [...results, { correct, reactionMs: Date.now() - stageStartedAtRef.current }];

    setOptionStatus({ selectedAngle: angle, correct });
    scheduleAdvance(nextResults);
  }

  async function handleMediumChoice(angle) {
    if (!currentTrial || matrixStatus) {
      return;
    }

    await triggerSelectionHaptic();
    const correct = angle === currentTrial.answerAngle;
    const nextResults = [...results, { correct, reactionMs: Date.now() - stageStartedAtRef.current }];

    setMatrixStatus({ selectedAngle: angle, correct });
    scheduleAdvance(nextResults);
  }

  async function handleHardResponderGrant(event) {
    if (!currentTrial || hardStageRef.current !== "choice" || optionStatus) {
      return;
    }

    const { x, y } = getHardLocalPoint(event);
    const angle = getHardChoiceAngleAtPoint(x, y);

    if (angle === null) {
      return;
    }

    await triggerSelectionHaptic();
    const correct = angle === currentTrial.heading;
    const stage1ReactionMs = Date.now() - stageStartedAtRef.current;

    setHardSelectedAngle(angle);
    setOptionStatus({ selectedAngle: angle, correct });

    if (!correct) {
      scheduleAdvance([
        ...results,
        {
          stage1Correct: false,
          stage2Correct: false,
          stage1ReactionMs,
          stage2ReactionMs: null,
        },
      ]);
      return;
    }

    hardStage1ReactionRef.current = stage1ReactionMs;
    hardStageRef.current = "placement";
    hardDragRef.current = { active: true, selectedAngle: angle };
    setHardStage("placement");
    stageStartedAtRef.current = Date.now();
    updateHardDragPreview(x, y);
  }

  async function submitHardPlacement(angle) {
    if (!currentTrial || (hardStage !== "placement" && hardStage !== "tap") || matrixStatus) {
      return;
    }

    await triggerSelectionHaptic();
    const correct = angle === currentTrial.answerAngle;
    const stage2ReactionMs = Date.now() - stageStartedAtRef.current;

    setMatrixStatus({ selectedAngle: angle, correct });
    setDragPreviewAngle(null);
    setDragPlanePosition(null);
    scheduleAdvance([
      ...results,
      {
        stage1Correct: true,
        stage2Correct: correct,
        stage1ReactionMs: hardStage1ReactionRef.current,
        stage2ReactionMs,
        fallback: hardFallbackRef.current,
      },
    ]);
  }

  function handleHardResponderMove(event) {
    if (hardStageRef.current !== "placement" || !hardDragRef.current.active) {
      return;
    }

    const { x, y } = getHardLocalPoint(event);
    updateHardDragPreview(x, y);
  }

  function handleHardResponderEnd(event) {
    if (hardStageRef.current !== "placement" || !hardDragRef.current.active) {
      return;
    }

    hardDragRef.current = { active: false, selectedAngle: hardDragRef.current.selectedAngle };
    const { x, y } = getHardLocalPoint(event);
    const dx = beaconCenterRef.current ? x - beaconCenterRef.current.x : Infinity;
    const dy = beaconCenterRef.current ? y - beaconCenterRef.current.y : Infinity;

    // Released outside the cells, or just tapped: the player may not know (or forgot) that the aircraft has to be
    // dragged. Rather than counting a miss, the gyro gives way to the aircraft and the position is picked by a tap,
    // like the medium level.
    if (!releasedInSlot(dx, dy)) {
      hardFallbackRef.current = true;
      hardStageRef.current = "tap";
      setHardStage("tap");
      setDragPreviewAngle(null);
      setDragPlanePosition(null);
      return;
    }

    void submitHardPlacement(getAngleFromDrag(dx, dy) ?? -1);
  }

  function renderEasyContent() {
    return (
      <View style={styles.easyLayout}>
        <View style={styles.topSingle}>
          <View style={styles.easyInstrument}>
            <Text style={styles.instrumentLabel}>GYRO</Text>
            <GyroCompass heading={currentTrial.heading} />
          </View>
        </View>

        <View style={[styles.optionsGrid, styles.optionsGridEasy]}>
          {currentTrial.optionAngles.map((angle) => {
            const isSelected = optionStatus?.selectedAngle === angle;

            return (
              <AircraftPoseCard
                key={`easy-${angle}`}
                angle={angle}
                onPress={() => handleEasyChoice(angle)}
                disabled={Boolean(optionStatus)}
                status={isSelected ? (optionStatus?.correct ? "correct" : "wrong") : "idle"}
              />
            );
          })}
        </View>
      </View>
    );
  }

  function renderMediumContent() {
    return (
      <>
        <View style={styles.instrumentRow}>
          <View style={styles.instrumentCard}>
            <Text style={styles.instrumentLabel}>AIRCRAFT</Text>
            <View style={styles.planePoseCard}>
              <View style={{ transform: [{ rotate: `${currentTrial.heading}deg` }] }}>
                <AircraftIcon size={76} />
              </View>
            </View>
          </View>

          <View style={styles.instrumentCard}>
            <Text style={styles.instrumentLabel}>BEACON</Text>
            <RelativeBearingDial bearing={currentTrial.relativeBearing} size={132} />
          </View>
        </View>

        <PlacementMatrix
          heading={currentTrial.heading}
          onSelect={handleMediumChoice}
          selectedAngle={matrixStatus?.selectedAngle ?? null}
          previewAngle={null}
          correctAngle={!matrixStatus?.correct ? currentTrial.answerAngle : null}
          selectedStatus={matrixStatus ? (matrixStatus.correct ? "correct" : "wrong") : "idle"}
          onMatrixLayout={(event) => {
            const layout = event.nativeEvent.layout;
            beaconCenterRef.current = {
              x: layout.x + 143,
              y: layout.y + 143,
            };
          }}
        />
      </>
    );
  }

  function renderHardContent() {
    return (
      <>
        <View style={styles.instrumentRow}>
          {hardStage === "tap" ? <View style={styles.instrumentCard}>
            <Text style={styles.instrumentLabel}>AIRCRAFT</Text>
            <View style={styles.planePoseCard}>
              <View style={{ transform: [{ rotate: `${hardSelectedAngle ?? currentTrial.heading}deg` }] }}>
                <AircraftIcon size={76} />
              </View>
            </View>
          </View> : <View style={styles.instrumentCard}>
            <Text style={styles.instrumentLabel}>GYRO</Text>
            <GyroCompass heading={currentTrial.heading} size={132} />
          </View>}

          <View style={styles.instrumentCard}>
            <Text style={styles.instrumentLabel}>BEACON</Text>
            <RelativeBearingDial bearing={currentTrial.relativeBearing} size={132} />
          </View>
        </View>

        <View
          style={styles.hardInteractionArea}
          ref={hardInteractionRef}
          onLayout={syncHardInteractionOrigin}
          onStartShouldSetResponderCapture={(event) => {
            if (hardStageRef.current !== "choice" || optionStatus || matrixStatus) {
              return false;
            }

            const { x, y } = getHardLocalPoint(event);
            return getHardChoiceAngleAtPoint(x, y) !== null;
          }}
          onResponderGrant={handleHardResponderGrant}
          onResponderMove={handleHardResponderMove}
          onResponderRelease={handleHardResponderEnd}
          onResponderTerminate={handleHardResponderEnd}
        >
          {hardStage === "choice" ? (
            <View
              style={styles.optionsGrid}
              onLayout={(event) => {
                optionsGridLayoutRef.current = event.nativeEvent.layout;
                syncHardInteractionOrigin();
              }}
            >
              {currentTrial.optionAngles.map((angle, index) => {
                const isSelected = optionStatus?.selectedAngle === angle;

                return (
                  <AircraftPoseCard
                    key={`hard-${angle}`}
                    angle={angle}
                    disabled
                    onLayout={(event) => {
                      const layout = event.nativeEvent.layout;
                      optionLayoutsRef.current[index] = {
                        index,
                        x: optionsGridLayoutRef.current.x + layout.x,
                        y: optionsGridLayoutRef.current.y + layout.y,
                        width: layout.width,
                        height: layout.height,
                      };
                    }}
                    status={isSelected ? (optionStatus?.correct ? "correct" : "wrong") : "idle"}
                  />
                );
              })}
            </View>
          ) : (
            <View
              style={styles.hardStageStack}
              onLayout={(event) => {
                hardStageLayoutRef.current = event.nativeEvent.layout;
                syncHardInteractionOrigin();
              }}
            >
              <PlacementMatrix
                heading={hardSelectedAngle ?? currentTrial.heading}
                onSelect={hardStage === "tap" ? submitHardPlacement : () => {}}
                interactive={hardStage === "tap" && !matrixStatus}
                selectedAngle={matrixStatus?.selectedAngle ?? null}
                previewAngle={dragPreviewAngle}
                correctAngle={!matrixStatus?.correct ? currentTrial.answerAngle : null}
                selectedStatus={matrixStatus ? (matrixStatus.correct ? "correct" : "wrong") : "idle"}
                onMatrixLayout={(event) => {
                  const layout = event.nativeEvent.layout;
                  beaconCenterRef.current = {
                    x: hardStageLayoutRef.current.x + layout.x + 143,
                    y: hardStageLayoutRef.current.y + layout.y + 143,
                  };
                }}
              />
            </View>
          )}

          {dragPlanePosition && hardStage === "placement" ? (
            <View
              pointerEvents="none"
              style={[
                styles.dragPlaneOverlay,
                {
                  left: dragPlanePosition.x - 43,
                  top: dragPlanePosition.y - 43,
                  transform: [{ rotate: `${hardSelectedAngle ?? currentTrial.heading}deg` }],
                },
              ]}
            >
                  <AircraftIcon size={76} />
            </View>
          ) : null}
        </View>
      </>
    );
  }

  const preflight = (
    <GameSetupShell
      title="Heading and Beacon"
      categoryKey="spatial"
      onExit={onExit}
      onStart={() => startMission(() => resetRun(selectedDifficulty))}
      rules="Tests heading and relative-position reasoning. Read instrument cues and identify the correct aircraft position.Easy: Match the aircraft to the gyro heading.Medium: Place the aircraft relative to the beacon.Hard: Match the heading, then drag it from the beacon to its position."
    >
      <PickerSetting
        label="Difficulty"
        options={difficultyOptions.map((option) => ({ value: option, label: option.label }))}
        value={selectedDifficulty}
        onChange={setSelectedDifficulty}
      />
      <PickerSetting
        label="Rounds"
        options={[5, 10, 15].map((value) => ({ value, label: String(value) }))}
        value={roundCount}
        onChange={setRoundCount}
      />
    </GameSetupShell>
  );

  return (
    <View style={styles.container}>
      {phase === "difficulty" || isReturning ? (
        <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflight}</Animated.View>
      ) : null}

      {phase !== "difficulty" ? (
        <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionLayer, !daily && missionStyle]}>
          <View style={styles.header}>
            <Pressable onPress={daily ? daily.onExit : returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
              <Text style={styles.backArrow}>←</Text>
            </Pressable>
          </View>

          {phase === "ready" && readyOption ? (
            <Pressable style={styles.readyScreen} onPress={startRun}>
              <Text style={styles.kicker}>{daily ? `DAILY TRAINING · STAGE ${DAILY_STAGES.findIndex((stage) => stage.mode === readyOption.key) + 1} / ${DAILY_STAGES.length}` : "SPATIAL ORIENTATION"}</Text>
              <Text style={styles.readyTitle}>{readyOption.introTitle}</Text>
              <Text style={styles.readyText}>{readyOption.example}{daily ? ` ${DAILY_STAGES.find((stage) => stage.mode === readyOption.key).rounds} rounds.` : ""}</Text>
              {readyOption.key === "hard" ? (
                <View style={styles.readyInstrumentRow}>
                  <GyroCompass heading={30} size={128} />
                  <RelativeBearingDial bearing={45} size={128} />
                </View>
              ) : (
                <View style={styles.readyInstrument}>
                  {readyOption.key === "easy" ? <GyroCompass heading={30} size={156} /> : <RelativeBearingDial bearing={45} size={156} />}
                </View>
              )}
              <PulsingPrompt color={THEME_ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt>
            </Pressable>
          ) : null}

          {phase === "playing" && currentTrial ? (
            <Animated.View entering={FadeIn.duration(160)} style={styles.playScreen}>
              <Text style={styles.progressText}>ROUND {trialIndex + 1} / {totalRounds} · {difficultyOptions.find((option) => option.key === mode)?.label}</Text>
              <Text style={styles.helperText}>
                {mode === "easy"
                  ? "Read the gyro, then select the matching aircraft."
                  : mode === "medium"
                    ? "Place the aircraft relative to the beacon."
                    : hardStage === "choice"
                      ? "Stage 1 · Select the aircraft matching the gyro."
                      : hardStage === "tap"
                        ? "Stage 2 · Tap the aircraft's position around the beacon."
                        : "Stage 2 · Drag from the beacon to the correct position."}
              </Text>
              {mode === "easy" ? renderEasyContent() : null}
              {mode === "medium" ? renderMediumContent() : null}
              {mode === "hard" ? renderHardContent() : null}
            </Animated.View>
          ) : null}

          {phase === "summary" && summary ? (
            <Animated.View entering={FadeIn.duration(180)} style={styles.summaryScreen}>
              <Text style={styles.kicker}>SESSION ENDED</Text>
              <Text style={styles.summaryTitle}>Navigation complete</Text>
              <Text style={styles.summaryCaption}>{roundCount} rounds processed</Text>
              <View style={styles.resultCard}>
                {selectedDifficulty?.key === "hard" ? (
                  <>
                    <Text style={styles.resultHeadline}>{summary.perfectRounds} perfect rounds</Text>
                    <Text style={styles.resultLine}>Heading match <Text style={styles.resultValue}>{summary.stage1Correct} / {roundCount}</Text></Text>
                    <Text style={styles.resultLine}>Beacon placement <Text style={styles.resultValue}>{summary.stage2Correct} / {roundCount}</Text></Text>
                    <Text style={styles.resultLine}>Average heading time <Text style={styles.resultValue}>{summary.stage1Average !== null ? `${summary.stage1Average} ms` : "—"}</Text></Text>
                    <Text style={styles.resultLine}>Average placement time <Text style={styles.resultValue}>{summary.stage2Average !== null ? `${summary.stage2Average} ms` : "—"}</Text></Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.resultHeadline}>{summary.accuracy}% accuracy</Text>
                    <Text style={styles.resultLine}>Correct responses <Text style={styles.resultValue}>{summary.correctCount} / {roundCount}</Text></Text>
                    <Text style={styles.resultLine}>Average reaction <Text style={styles.resultValue}>{summary.averageReaction !== null ? `${summary.averageReaction} ms` : "—"}</Text></Text>
                    <Text style={styles.resultLine}>Best reaction <Text style={styles.resultValue}>{summary.bestReaction !== null ? `${summary.bestReaction} ms` : "—"}</Text></Text>
                  </>
                )}
              </View>
              <View style={styles.actions}>
                <TouchableOpacity activeOpacity={0.88} onPress={() => resetRun(selectedDifficulty)} style={styles.primaryButton}>
                  <Text style={styles.primaryButtonText}>Play again</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.88} onPress={returnToPreflight} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Change settings</Text>
                </TouchableOpacity>
              </View>
            </Animated.View>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SPACE_CADET.black },
  preflightLayer: { ...StyleSheet.absoluteFill, zIndex: 1 },
  missionLayer: { flex: 1, backgroundColor: SPACE_CADET.black, zIndex: 2 },
  header: { height: 64, paddingHorizontal: 20, justifyContent: "center" },
  backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  backArrow: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 32, lineHeight: 36 },
  pressed: { transform: [{ scale: 0.97 }] },
  kicker: { color: THEME_ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.9, textAlign: "center" },
  readyScreen: { flex: 1, alignItems: "center", paddingHorizontal: 28, paddingTop: 66 },
  readyTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 31, marginTop: 9, textAlign: "center" },
  readyText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 21, maxWidth: 306, textAlign: "center", marginTop: 12 },
  readyInstrument: { marginTop: 42 },
  readyInstrumentRow: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 42 },
  beginPrompt: { marginTop: 44, textAlign: "center" },
  playScreen: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  progressText: {
    fontFamily: "Gontserrat-SemiBold",
    fontSize: 10,
    color: THEME_ACCENT,
    letterSpacing: 1.7,
    textTransform: "uppercase",
    marginTop: 25,
    marginBottom: 9,
  },
  helperText: {
    fontFamily: "Garet-Book",
    fontSize: 16,
    lineHeight: 22,
    color: SPACE_CADET.textSecondary,
    textAlign: "center",
    maxWidth: 330,
    marginBottom: 20,
  },
  easyLayout: {
    flex: 1,
    width: "100%",
    justifyContent: "space-between",
    paddingBottom: 8,
  },
  topSingle: {
    width: "100%",
    alignItems: "center",
    marginBottom: 10,
  },
  easyInstrument: {
    width: "100%",
    alignItems: "center",
  },
  instrumentRow: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 18,
  },
  instrumentCard: {
    flex: 1,
    backgroundColor: SPACE_CADET.surface1,
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: "center",
  },
  instrumentCardEasy: {
    paddingVertical: 12,
  },
  instrumentLabel: {
    fontFamily: "Gontserrat-SemiBold",
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: THEME_MUTED,
    marginBottom: 10,
  },
  instrumentShell: {
    alignItems: "center",
    justifyContent: "center",
  },
  centerAircraft: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  planePoseCard: {
    width: 168,
    height: 168,
    borderRadius: 28,
    backgroundColor: SPACE_CADET.black,
    alignItems: "center",
    justifyContent: "center",
  },
  optionsGrid: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 10,
  },
  optionsGridEasy: {
    rowGap: 8,
    marginTop: "auto",
  },
  poseCard: {
    width: "48%",
    minHeight: 124,
    borderRadius: 22,
    backgroundColor: SPACE_CADET.surface1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  poseCardCompact: {
    minHeight: 88,
  },
  poseCardLarge: {
    width: 180,
    alignSelf: "center",
  },
  poseCardCorrect: {
    backgroundColor: "#102A22",
    borderColor: SUCCESS,
  },
  poseCardWrong: {
    backgroundColor: "#35151D",
    borderColor: ERROR,
  },
  posePlaceholder: {
    width: "48%",
    minHeight: 132,
  },
  matrixWrapper: {
    width: "100%",
    alignItems: "center",
  },
  matrixGrid: {
    width: 286,
    height: 286,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  matrixCell: {
    width: 88.5,
    height: 88.5,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  matrixSlot: {
    backgroundColor: SPACE_CADET.surface1,
    borderWidth: 1,
    borderColor: "transparent",
  },
  matrixSlotPreview: {
    borderColor: THEME_ACCENT,
    borderWidth: 2,
  },
  matrixSlotCorrect: {
    backgroundColor: "#102A22",
    borderColor: SUCCESS,
  },
  matrixSlotWrong: {
    backgroundColor: "#35151D",
    borderColor: ERROR,
  },
  beaconOuter: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 3,
    borderColor: THEME_ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },
  beaconMiddle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2.5,
    borderColor: THEME_ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },
  beaconInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: THEME_ACCENT,
  },
  hardStageStack: {
    width: "100%",
    alignItems: "center",
    gap: 16,
  },
  hardInteractionArea: {
    width: "100%",
    flex: 1,
  },
  dragPlaneOverlay: {
    position: "absolute",
    width: 68,
    height: 68,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryScreen: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 58, paddingBottom: 28 },
  summaryTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 31, marginTop: 8 },
  summaryCaption: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", fontSize: 17, marginTop: 8, marginBottom: 26 },
  resultCard: {
    width: "100%",
    backgroundColor: SPACE_CADET.surface1,
    borderRadius: 24,
    padding: 20,
  },
  resultHeadline: {
    fontFamily: "Gontserrat-Light",
    fontSize: 25,
    color: SPACE_CADET.white,
    marginBottom: 14,
  },
  resultLine: {
    fontFamily: "Gontserrat-Regular",
    fontSize: 13,
    color: SPACE_CADET.textSecondary,
    lineHeight: 24,
  },
  resultValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 15 },
  actions: {
    width: "100%",
    gap: 12,
    marginTop: "auto",
  },
  primaryButton: {
    backgroundColor: SPACE_CADET.white,
    borderRadius: 999,
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontFamily: "Gontserrat-Regular",
    fontSize: 16,
    lineHeight: 20,
    color: SPACE_CADET.black,
    transform: [{ translateY: 2 }],
  },
  secondaryButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: SPACE_CADET.borderDefault,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontFamily: "Gontserrat-Regular",
    fontSize: 15,
    lineHeight: 19,
    color: SPACE_CADET.white,
    transform: [{ translateY: 2 }],
  },
});
