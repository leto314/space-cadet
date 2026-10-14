import { StyleSheet, View } from "react-native";
import { Fragment } from "react";
import Svg, { Defs, FeGaussianBlur, Filter, Polygon } from "react-native-svg";

const FACE_DEFINITIONS = [
  {
    key: "front",
    vertices: [
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
    normal: [0, 0, 1],
  },
  {
    key: "back",
    vertices: [
      [1, -1, -1],
      [-1, -1, -1],
      [-1, 1, -1],
      [1, 1, -1],
    ],
    normal: [0, 0, -1],
  },
  {
    key: "left",
    vertices: [
      [-1, -1, -1],
      [-1, -1, 1],
      [-1, 1, 1],
      [-1, 1, -1],
    ],
    normal: [-1, 0, 0],
  },
  {
    key: "right",
    vertices: [
      [1, -1, 1],
      [1, -1, -1],
      [1, 1, -1],
      [1, 1, 1],
    ],
    normal: [1, 0, 0],
  },
  {
    key: "top",
    vertices: [
      [-1, 1, 1],
      [1, 1, 1],
      [1, 1, -1],
      [-1, 1, -1],
    ],
    normal: [0, 1, 0],
  },
  {
    key: "bottom",
    vertices: [
      [-1, -1, -1],
      [1, -1, -1],
      [1, -1, 1],
      [-1, -1, 1],
    ],
    normal: [0, -1, 0],
  },
];

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function applyMatrix(matrix, point) {
  return [
    matrix[0][0] * point[0] + matrix[0][1] * point[1] + matrix[0][2] * point[2],
    matrix[1][0] * point[0] + matrix[1][1] * point[1] + matrix[1][2] * point[2],
    matrix[2][0] * point[0] + matrix[2][1] * point[1] + matrix[2][2] * point[2],
  ];
}

function projectPoint(point, viewportSize) {
  const cameraDistance = 6;
  const factor = cameraDistance / (cameraDistance - point[2]);
  const scale = viewportSize * 0.27;
  const center = viewportSize / 2;

  return {
    x: center + point[0] * scale * factor,
    y: center - point[1] * scale * factor,
    z: point[2],
  };
}

function buildFaces(matrix, highlightFace, viewportSize) {
  return FACE_DEFINITIONS.map((face) => {
    const transformedVertices = face.vertices.map((vertex) => applyMatrix(matrix, vertex));
    const transformedNormal = applyMatrix(matrix, face.normal);
    const averageZ =
      transformedVertices.reduce((sum, vertex) => sum + vertex[2], 0) / transformedVertices.length;

    const projectedPoints = transformedVertices.map((vertex) => projectPoint(vertex, viewportSize));
    const pointString = projectedPoints.map((point) => `${point.x},${point.y}`).join(" ");

    const brightness = clamp(5 + transformedNormal[2] * 6 + transformedNormal[1] * 2, 3, 13);
    const fillColor =
      face.key === highlightFace
        ? `rgb(${brightness + 3}, ${brightness + 8}, ${brightness + 17})`
        : `rgb(${brightness}, ${brightness + 2}, ${brightness + 6})`;

    return {
      key: face.key,
      visible: transformedNormal[2] > 0.02,
      averageZ,
      points: pointString,
      fill: fillColor,
    };
  })
    .filter((face) => face.visible)
    .sort((left, right) => left.averageZ - right.averageZ);
}

export function CubeRenderer({ matrix, pulseLevel, highlightFace, accent = "#4C8DFF" }) {
  const viewportSize = 240;
  const faces = buildFaces(matrix, highlightFace, viewportSize);

  return (
    <View style={styles.wrapper}>
      <Svg width={viewportSize} height={viewportSize} viewBox={`0 0 ${viewportSize} ${viewportSize}`}>
        <Defs>
          <Filter id="cube-edge-glow" x="-40%" y="-40%" width="180%" height="180%">
            <FeGaussianBlur stdDeviation="6" />
          </Filter>
        </Defs>
        {faces.map((face) => (
          <Fragment key={face.key}>
            <Polygon
              key={`${face.key}-glow`}
              points={face.points}
              fill="none"
              stroke={accent}
              strokeOpacity={0.1 + pulseLevel * 0.18}
              strokeWidth="3"
              strokeLinejoin="round"
              filter="url(#cube-edge-glow)"
            />
            <Polygon
              key={face.key}
              points={face.points}
              fill={face.fill}
              stroke={accent}
              strokeOpacity={0.66 + pulseLevel * 0.34}
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
          </Fragment>
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: 240,
    height: 240,
    alignItems: "center",
    justifyContent: "center",
  },
});
