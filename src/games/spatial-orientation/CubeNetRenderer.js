import { StyleSheet, View } from "react-native";
import Svg, { Polygon } from "react-native-svg";

import { SPACE_CADET } from "../../theme/spaceCadet";

// The cube unfolding into its net (progress 0 → 1), then the six faces as answer panels. `result`
// ({ selected, correct }) outlines the right face in green and a wrong pick in red.
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

const styles = StyleSheet.create({
  netWrapper: { width: 280, height: 360, alignItems: "center", justifyContent: "center" },
});
